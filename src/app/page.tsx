'use client';

import { useState, useEffect, useRef } from 'react';
import { 
  Columns2, Smartphone, ChevronRight, Eye, EyeOff, Loader2, X, 
  BrainCircuit, Trash2, Upload, PlusCircle, ChevronDown, ChevronUp, 
  LogOut, History, Plus, FileText, ImageIcon, Sparkles, ChevronLeft, 
  GraduationCap, Settings, Share2, Copy, Bookmark, Verified, Terminal
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import Latex from 'react-latex-next';
import ReactCrop, { type Crop, PixelCrop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import 'katex/dist/katex.min.css';

// --- Types ---
type SessionStatus = 'idle' | 'waiting' | 'uploading' | 'cropping' | 'processing' | 'ready';
type ImageType = 'question' | 'solution';
type AppMode = 'breaker' | 'extractor';

interface ExtractedQuestion {
  type: string;
  question: string;
  options?: string[];
  answer: string;
  solution: string;
}

interface QuestionData {
  id?: string;
  questionImageUrl: string | null;
  questionText: string;
  solutionImageUrl: string | null;
  solutionText: string;
  extractedText: string;
  isQuestionTextMode?: boolean;
  isSolutionTextMode?: boolean;
  status?: string;
  variations: { category: string; text: string; solution: string; }[];
  created_at?: string;
}

export default function QuestionBreaker() {
  // Navigation & Mode
  const [activeMode, setActiveMode] = useState<AppMode>('breaker');
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Persistence States
  const [roomId, setRoomId] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState<string>('');
  const [isInitializing, setIsInitializing] = useState(true);

  // App States
  const [status, setStatus] = useState<SessionStatus>('idle');
  const [aiStep, setAiStep] = useState<string>('idle');
  const [debugLog, setDebugLog] = useState<string>('');
  const [expandedVariations, setExpandedVariations] = useState<Record<number, boolean>>({});
  const [showSolutions, setShowSolutions] = useState<Record<number, boolean>>({});
  const [history, setHistory] = useState<QuestionData[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  
  const [data, setData] = useState<QuestionData>({ 
    questionImageUrl: null, 
    questionText: '',
    solutionImageUrl: null, 
    solutionText: '',
    extractedText: '', 
    variations: [] 
  });

  // Extractor States
  const [extractContent, setExtractContent] = useState('');
  const [extractSubject, setExtractSubject] = useState('');
  const [extractLevel, setExtractLevel] = useState('Secondary School');
  const [extractedQuestions, setExtractedQuestions] = useState<ExtractedQuestion[]>([]);
  const [extractConceptTree, setExtractConceptTree] = useState<string[]>([]);
  const [currentExtractIdx, setCurrentExtractIdx] = useState(0);
  const [allConceptsTested, setAllConceptsTested] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isAddingMore, setIsAddingMore] = useState(false);
  const [showExtractedSolutions, setShowExtractedSolutions] = useState<Record<number, boolean>>({});

  // Workflow States
  const [isQuestionTextMode, setIsQuestionTextMode] = useState(false);
  const [isSolutionTextMode, setIsSolutionTextMode] = useState(true);
  const [isSolutionEnabled, setIsSolutionEnabled] = useState(false);

  // Media State
  const [activeUploadType, setActiveUploadType] = useState<ImageType>('question');
  const [imgSrc, setImgSrc] = useState('');
  const imgRef = useRef<HTMLImageElement>(null);
  const [crop, setCrop] = useState<Crop>();
  const [completedCrop, setCompletedCrop] = useState<PixelCrop>();
  const [rawFile, setRawFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- Logic Hooks (Preserved) ---
  useEffect(() => {
    const bootstrap = async () => {
      await supabase.auth.signInAnonymously();
      const savedRoomId = localStorage.getItem('qb_active_room_id');
      const savedCode = localStorage.getItem('qb_pairing_code');
      const savedLevel = localStorage.getItem('qb_extract_level');
      if (savedLevel) setExtractLevel(savedLevel);
      if (savedRoomId) {
        setRoomId(savedRoomId);
        setPairingCode(savedCode || '');
        await syncLatestData(savedRoomId);
        setupRealtime(savedRoomId);
        fetchHistory(savedRoomId);
      }
      setIsInitializing(false);
    };
    bootstrap();

    const handleGlobalPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          const file = items[i].getAsFile();
          if (file) {
            e.preventDefault();
            let targetType = activeUploadType;
            if (document.activeElement?.classList.contains('question-input')) targetType = 'question';
            else if (document.activeElement?.classList.contains('solution-input')) targetType = 'solution';
            setActiveUploadType(targetType);
            setRawFile(file);
            const reader = new FileReader();
            reader.onload = () => { setImgSrc(reader.result?.toString() || ''); setStatus('cropping'); };
            reader.readAsDataURL(file);
          }
        }
      }
    };
    window.addEventListener('paste', handleGlobalPaste);
    return () => window.removeEventListener('paste', handleGlobalPaste);
  }, [activeUploadType]);

  const fetchHistory = async (rId: string) => {
    const { data: qList } = await supabase.from('questions').select('*').eq('room_id', rId).order('created_at', { ascending: false });
    if (qList) setHistory(qList.map((q: any) => ({
      id: q.id,
      questionImageUrl: q.question_image_url,
      questionText: q.question_text || '',
      solutionImageUrl: q.solution_image_url,
      solutionText: q.solution_text || '',
      extractedText: q.extracted_text || '',
      variations: q.variations || [],
      isQuestionTextMode: q.is_question_text_mode,
      isSolutionTextMode: q.is_solution_text_mode,
      created_at: q.created_at,
      status: q.status
    })));
  };

  const syncLatestData = async (rId: string) => {
    const { data: qData } = await supabase.from('questions').select('*').eq('room_id', rId).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (qData) updateLocalState(qData);
  };

  const updateLocalState = (newData: any, isRemote = false) => {
    setData(p => ({
      ...p,
      id: newData.id,
      questionImageUrl: newData.question_image_url,
      questionText: (isRemote && !document.activeElement?.classList.contains('question-input')) ? (newData.question_text || '') : p.questionText,
      solutionImageUrl: newData.solution_image_url,
      solutionText: (isRemote && !document.activeElement?.classList.contains('solution-input')) ? (newData.solution_text || '') : p.solutionText,
      extractedText: newData.extracted_text || '',
      variations: newData.variations || []
    }));
    if (isRemote) {
       if (newData.status === 'processing' || newData.status === 'ready') {
          setIsQuestionTextMode(!!newData.is_question_text_mode);
          setIsSolutionTextMode(!!newData.is_solution_text_mode);
       }
    }
    if (newData.solution_image_url || newData.solution_text) setIsSolutionEnabled(true);
    if (newData.status === 'ready') setStatus('ready');
    else if (newData.status === 'processing') setStatus('processing');
    else setStatus('waiting');
  };

  const setupRealtime = (rId: string) => {
    const channel = supabase.channel(`room_${rId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'questions', filter: `room_id=eq.${rId}` }, (payload: any) => {
        const newData = payload.new as any;
        if (!newData) return;
        updateLocalState(newData, true);
        fetchHistory(rId);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  };

  const createRoom = async () => {
    try {
      const code = Math.random().toString(36).substring(2, 8).toUpperCase();
      let { data: { user } } = await supabase.auth.getUser();
      if (!user) { const { data: authData } = await supabase.auth.signInAnonymously(); user = authData.user; }
      if (!user) throw new Error("Auth failed");
      const { data: room, error: roomError } = await supabase.from('rooms').insert([{ owner_id: user.id, pairing_code: code }]).select().single();
      if (roomError) throw roomError;
      if (room) {
        localStorage.setItem('qb_active_room_id', room.id);
        localStorage.setItem('qb_pairing_code', code);
        setRoomId(room.id);
        setPairingCode(code);
        setupRealtime(room.id);
        setStatus('waiting');
      }
    } catch (err: any) { alert("Error: " + err.message); }
  };

  const joinRoom = async (code: string) => {
    const cleanCode = code.toUpperCase().trim();
    const { data: room } = await supabase.from('rooms').select('*').eq('pairing_code', cleanCode).eq('is_active', true).maybeSingle();
    if (room) {
      localStorage.setItem('qb_active_room_id', room.id);
      localStorage.setItem('qb_pairing_code', cleanCode);
      setRoomId(room.id);
      setPairingCode(cleanCode);
      await syncLatestData(room.id);
      setupRealtime(room.id);
      fetchHistory(room.id);
    } else alert("Room not found.");
  };

  const resetSession = () => { localStorage.clear(); window.location.reload(); };

  const startNewQuestion = () => {
    setData({ questionImageUrl: null, questionText: '', solutionImageUrl: null, solutionText: '', extractedText: '', variations: [] });
    setStatus('waiting');
    setIsSolutionEnabled(false);
  };

  const loadFromHistory = (item: QuestionData) => {
    setData(item);
    setIsQuestionTextMode(!!item.isQuestionTextMode);
    setIsSolutionTextMode(!!item.isSolutionTextMode);
    setIsSolutionEnabled(!!(item.solutionImageUrl || item.solutionText));
    setStatus(item.status as SessionStatus || 'ready');
    setShowHistory(false);
  };

  const handleExtract = async () => {
    if (!extractContent.trim()) return;
    setIsExtracting(true);
    setExtractedQuestions([]);
    setExtractConceptTree([]);
    setShowExtractedSolutions({});
    try {
      const resp = await fetch('/api/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'extract', extractContent, subject: extractSubject, level: extractLevel })
      });
      const result = await resp.json();
      if (result.questions) {
        setExtractedQuestions(result.questions);
        setExtractConceptTree(result.conceptTree || []);
        setAllConceptsTested(!!result.allConceptsTested);
      } else if (result.error) alert("Extraction Error: " + result.error);
    } catch (err: any) { alert("Network Error: " + err.message); }
    finally { setIsExtracting(false); }
  };

  const handleMoreQuestions = async () => {
    if (!extractContent.trim() || isAddingMore) return;
    setIsAddingMore(true);
    try {
      const resp = await fetch('/api/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'extract', extractContent, subject: extractSubject, level: extractLevel, existingQuestions: extractedQuestions })
      });
      const result = await resp.json();
      if (result.questions) {
        setExtractedQuestions(prev => [...prev, ...result.questions]);
        if (result.conceptTree) setExtractConceptTree(result.conceptTree);
        setAllConceptsTested(!!result.allConceptsTested);
      } else if (result.error) alert("Expansion Error: " + result.error);
    } catch (err: any) { alert("Network Error: " + err.message); }
    finally { setIsAddingMore(false); }
  };

  const saveToDb = async (updates: Partial<QuestionData>, newStatus?: string) => {
    if (!roomId) return null;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) await supabase.auth.signInAnonymously();
    const payload: any = {
      room_id: roomId,
      question_image_url: updates.questionImageUrl ?? data.questionImageUrl,
      question_text: updates.questionText ?? data.questionText,
      solution_image_url: updates.solutionImageUrl ?? data.solutionImageUrl,
      solution_text: updates.solutionText ?? data.solutionText,
      is_question_text_mode: isQuestionTextMode,
      is_solution_text_mode: isSolutionTextMode,
      status: newStatus || 'waiting'
    };
    try {
      if (data.id) { 
        const { error } = await supabase.from('questions').update(payload).eq('id', data.id);
        if (error) return null;
        return data.id;
      } else { 
        const { data: created, error } = await supabase.from('questions').insert([payload]).select().single(); 
        if (error) return null;
        if (created) { setData(p => ({ ...p, id: created.id })); return created.id; }
      }
    } catch (err: any) {}
    return null;
  };

  const handleProcessWithAI = async () => {
    if (!roomId) return;
    setStatus('processing');
    setAiStep('Initializing...');
    const currentQuestionId = await saveToDb({ isQuestionTextMode, isSolutionTextMode }, 'processing');
    if (!currentQuestionId) { setStatus('waiting'); return; }
    try {
      setAiStep('Processing Logic...');
      const resp = await fetch('/api/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questionImageUrl: isQuestionTextMode ? null : data.questionImageUrl,
          questionText: isQuestionTextMode ? data.questionText : null,
          solutionImageUrl: (isSolutionEnabled && !isSolutionTextMode) ? data.solutionImageUrl : null,
          solutionText: (isSolutionEnabled && isSolutionTextMode) ? data.solutionText : null
        })
      });
      setAiStep('Generating...');
      const result = await resp.json();
      if (result.error) { setAiStep('Error'); await saveToDb({}, 'waiting'); return; }
      setAiStep('Finalizing...');
      await supabase.from('questions').update({ extracted_text: result.extractedText, variations: result.variations, status: 'ready' }).eq('id', currentQuestionId);
      setStatus('ready'); fetchHistory(roomId);
    } catch (err: any) { await saveToDb({}, 'waiting'); setStatus('waiting'); }
  };

  const uploadToSupabase = async (file: File, type: ImageType) => {
    try {
      const fileName = `${roomId}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.]/g, '_')}`;
      const { error } = await supabase.storage.from('questions').upload(fileName, file);
      if (error) throw error;
      const { data: { publicUrl } } = supabase.storage.from('questions').getPublicUrl(fileName);
      const updates = type === 'question' ? { questionImageUrl: publicUrl } : { solutionImageUrl: publicUrl };
      await saveToDb(updates, 'waiting');
      setStatus('waiting'); setImgSrc('');
    } catch (err: any) { setStatus('waiting'); }
  };

  const onSelectFile = (e: React.ChangeEvent<HTMLInputElement>, type: ImageType) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      setRawFile(file); setActiveUploadType(type);
      const reader = new FileReader();
      reader.onload = () => { setImgSrc(reader.result?.toString() || ''); setStatus('cropping'); };
      reader.readAsDataURL(file);
    }
  };

  const handleConfirmCrop = async () => {
    if (!imgRef.current || !completedCrop) return;
    setStatus('uploading');
    const canvas = document.createElement('canvas');
    const scaleX = imgRef.current.naturalWidth / imgRef.current.width;
    const scaleY = imgRef.current.naturalHeight / imgRef.current.height;
    canvas.width = completedCrop.width * scaleX; canvas.height = completedCrop.height * scaleY;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(imgRef.current, completedCrop.x * scaleX, completedCrop.y * scaleY, completedCrop.width * scaleX, completedCrop.height * scaleY, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(async (blob) => { if (blob) await uploadToSupabase(new File([blob], `crop.jpg`, { type: 'image/jpeg' }), activeUploadType); }, 'image/jpeg', 1.0);
  };

  if (isInitializing) return <div className="min-h-screen bg-slate-50 flex items-center justify-center"><Loader2 className="animate-spin text-blue-600" /></div>;

  return (
    <div className="h-screen bg-[#faf9fa] text-[#1b1c1d] font-sans antialiased selection:bg-[#d9e2ff] selection:text-[#001946] flex flex-col md:flex-row overflow-hidden">
      {/* MOBILE HEADER */}
      <header className="md:hidden fixed top-0 w-full z-50 bg-white/80 backdrop-blur-xl flex justify-between items-center px-6 py-4 border-b border-slate-200/60">
        <div className="flex items-center gap-3">
          <button onClick={() => setShowHistory(true)} className="text-blue-700 active:scale-90 transition-transform">
            <History size={20} />
          </button>
          <h1 className="font-serif italic font-black text-blue-800 text-lg tracking-tight">Question Breaker</h1>
        </div>
        <button className="text-blue-700 active:scale-90 transition-transform">
          <Settings size={20} />
        </button>
      </header>

      {/* DESKTOP SIDEBAR */}
      <aside className="hidden md:flex w-64 z-50 bg-white border-r border-slate-200/60 flex-col py-10 px-6 shrink-0 h-full">
        <div className="mb-12 px-2">
          <h1 className="font-serif text-2xl font-bold text-slate-900 tracking-tight">Question Breaker</h1>
          <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400 font-bold mt-1.5">Premium Pedagogy</p>
        </div>

        <nav className="flex-1 space-y-2">
          <button 
            onClick={() => setActiveMode('breaker')}
            className={`w-full flex items-center justify-between px-4 py-3 rounded-lg transition-all duration-300 text-sm font-medium relative group ${activeMode === 'breaker' ? 'text-blue-700 bg-slate-50' : 'text-slate-500 hover:bg-slate-50'}`}
          >
            <div className="flex items-center gap-4">
              <BrainCircuit size={18} className={activeMode === 'breaker' ? 'text-blue-700' : 'text-slate-400'} />
              <span>Breaker</span>
            </div>
            {activeMode === 'breaker' && <div className="absolute right-0 h-4 w-[2.5px] bg-blue-700 rounded-full"></div>}
          </button>
          <button 
            onClick={() => setActiveMode('extractor')}
            className={`w-full flex items-center justify-between px-4 py-3 rounded-lg transition-all duration-300 text-sm font-medium relative group ${activeMode === 'extractor' ? 'text-blue-700 bg-slate-50' : 'text-slate-500 hover:bg-slate-50'}`}
          >
            <div className="flex items-center gap-4">
              <Sparkles size={18} className={activeMode === 'extractor' ? 'text-blue-700' : 'text-slate-400'} />
              <span>Extractor</span>
            </div>
            {activeMode === 'extractor' && <div className="absolute right-0 h-4 w-[2.5px] bg-blue-700 rounded-full"></div>}
          </button>
        </nav>

        <div className="mt-auto pt-8 border-t border-slate-200/60 space-y-2">
          <button onClick={() => setShowHistory(true)} className="w-full flex items-center gap-4 px-4 py-3 text-slate-500 hover:bg-slate-50 rounded-lg transition-all text-sm font-medium">
            <History size={18} className="text-slate-400" />
            <span>History</span>
          </button>
          <button className="w-full flex items-center gap-4 px-4 py-3 text-slate-500 hover:bg-slate-50 rounded-lg transition-all text-sm font-medium">
            <X size={18} className="text-slate-400" />
            <span>Help</span>
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col h-full overflow-hidden">
        {/* DESKTOP HEADER */}
        <header className="hidden md:flex bg-[#faf9fa] justify-between items-center px-10 h-20 shrink-0">
          <div className="flex items-center gap-4">
            <span className="font-serif font-bold text-blue-900 tracking-tight text-xl">
              {activeMode === 'breaker' ? 'Analysis View' : 'Workspace'}
            </span>
          </div>
          <div className="flex items-center gap-6">
            <button onClick={() => setShowHistory(true)} className="p-2 text-slate-400 hover:text-slate-600 transition-colors"><History size={20}/></button>
            <button className="p-2 text-slate-400 hover:text-slate-600 transition-colors"><Settings size={20}/></button>
          </div>
        </header>

        {/* CROP OVERLAY */}
        {status === 'cropping' && imgSrc && (
          <div className="fixed inset-0 z-[100] bg-slate-900/95 backdrop-blur-sm flex flex-col">
            <div className="p-4 flex justify-between items-center text-white bg-slate-950 border-b border-white/5">
              <button onClick={() => setStatus('waiting')} className="p-2 hover:bg-white/10 rounded-full"><X /></button>
              <span className="font-bold text-xs uppercase tracking-widest">Adjust Crop Area</span>
              <button onClick={handleConfirmCrop} className="bg-blue-600 px-8 py-2 rounded-full font-black text-xs uppercase shadow-xl hover:bg-blue-700 transition-all">Confirm Crop</button>
            </div>
            <div className="flex-1 overflow-auto flex items-center justify-center p-8">
              <ReactCrop crop={crop} onChange={c => setCrop(c)} onComplete={c => setCompletedCrop(c)}>
                <img ref={imgRef} src={imgSrc} alt="Crop" className="max-w-full max-h-[70vh] object-contain rounded-lg shadow-2xl" />
              </ReactCrop>
            </div>
          </div>
        )}

        {/* HISTORY SIDEBAR */}
        {showHistory && (
          <div className="fixed inset-0 z-[80] bg-slate-900/40 backdrop-blur-sm flex justify-end">
            <div className="w-full max-w-md bg-white h-full shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">
              <div className="p-6 border-b flex justify-between items-center">
                <h2 className="font-bold uppercase tracking-widest text-xs flex items-center gap-2 text-slate-400"><History size={16}/> Session History</h2>
                <button onClick={() => setShowHistory(false)} className="p-2 hover:bg-slate-100 rounded-full transition-colors"><X size={18}/></button>
              </div>
              <div className="flex-1 overflow-y-auto p-6 space-y-3">
                <button onClick={startNewQuestion} className="w-full p-4 border-2 border-dashed border-blue-100 rounded-xl text-blue-600 font-bold text-xs uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-blue-50 transition-all mb-4">
                  <Plus size={16}/> New Question
                </button>
                {history.map((item, idx) => (
                  <button key={idx} onClick={() => loadFromHistory(item)} className={`w-full text-left p-4 rounded-xl border transition-all ${data.id === item.id ? 'border-blue-600 bg-blue-50/30' : 'border-slate-100 bg-slate-50/50 hover:border-slate-200'}`}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-[10px] font-bold uppercase text-slate-400">{item.created_at ? new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Recent'}</span>
                      {item.status === 'ready' && <div className="w-1 h-1 rounded-full bg-green-500"></div>}
                    </div>
                    <p className="text-xs font-medium text-slate-600 line-clamp-2">{item.questionText || (item.questionImageUrl ? '[Question Image]' : 'Empty Question')}</p>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        <main className="flex-1 overflow-y-auto scrollbar-hide md:overflow-hidden pb-24 md:pb-0">
          {activeMode === 'breaker' ? (
            !roomId ? (
              /* JOIN SCREEN */
              <div className="flex-1 flex flex-col items-center justify-center p-6 h-full bg-slate-50">
                <div className="max-w-sm w-full space-y-8 bg-white p-10 rounded-2xl shadow-sm border border-slate-200/50 text-center">
                  <h1 className="text-3xl font-serif font-black text-slate-900 tracking-tighter">Question Breaker</h1>
                  <button onClick={createRoom} className="w-full flex items-center justify-center gap-3 p-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold transition-all shadow-lg shadow-blue-200">
                    <Plus size={20} />
                    <span>Start New Session</span>
                  </button>
                  <div className="relative py-2 text-[10px] text-slate-400 uppercase tracking-widest flex items-center justify-center gap-4">
                    <div className="h-px flex-1 bg-slate-100"></div>OR<div className="h-px flex-1 bg-slate-100"></div>
                  </div>
                  <div className="space-y-3">
                    <input type="text" placeholder="6-DIGIT CODE" className="w-full p-4 rounded-xl border border-slate-200 text-center font-mono text-xl uppercase tracking-widest focus:ring-2 focus:ring-blue-500/20 outline-none transition-all" onChange={(e) => setPairingCode(e.target.value.toUpperCase())} value={pairingCode} />
                    <button onClick={() => joinRoom(pairingCode)} className="w-full p-4 bg-slate-900 text-white rounded-xl font-bold hover:bg-black transition-all">Join Session</button>
                  </div>
                </div>
              </div>
            ) : (
              /* BREAKER VIEW (Mobile Optimized) */
              <div className="flex flex-col md:flex-row h-full overflow-hidden">
                {/* Left: Input Column */}
                <section className="w-full md:w-[60%] p-6 md:p-10 bg-white md:overflow-y-auto scrollbar-hide space-y-8 md:space-y-12">
                  <header className="md:block">
                    <span className="md:hidden label-style text-[10px] font-bold uppercase tracking-widest text-blue-600">Current Module</span>
                    <h2 className="font-headline text-2xl md:text-3xl font-bold text-slate-900 mt-1 md:mt-0">Source Materials</h2>
                    <p className="text-sm text-slate-500 mt-2 font-medium italic md:not-italic">Upload the question and the ideal solution path.</p>
                  </header>

                  <div className="space-y-10">
                    {/* The Question Input Area */}
                    <div className="space-y-4">
                      {isQuestionTextMode ? (
                        <div className="space-y-2">
                           <div className="flex justify-between items-center px-1">
                             <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">The Question</label>
                             <button onClick={() => setIsQuestionTextMode(false)} className="text-[10px] font-bold uppercase text-blue-600 hover:underline">Switch to Image</button>
                           </div>
                           <textarea placeholder="Paste or type question here..." value={data.questionText} onChange={(e) => setData(p => ({ ...p, questionText: e.target.value }))} onBlur={(e) => saveToDb({ questionText: e.target.value })} className="question-input w-full min-h-[180px] bg-slate-50/50 rounded-xl p-6 text-base border border-slate-200 focus:ring-2 focus:ring-blue-500/10 outline-none transition-all resize-none font-body leading-relaxed" />
                        </div>
                      ) : (
                        data.questionImageUrl ? (
                          <div className="space-y-2">
                            <div className="flex justify-between items-center px-1">
                              <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">The Question</label>
                              <button onClick={() => setIsQuestionTextMode(true)} className="text-[10px] font-bold uppercase text-blue-600 hover:underline">Switch to Text</button>
                            </div>
                            <div className="relative group">
                              <img src={data.questionImageUrl} alt="Question" className="w-full rounded-xl border border-slate-200 shadow-sm cursor-pointer hover:opacity-95 transition-all" onClick={() => { setActiveUploadType('question'); fileInputRef.current?.click(); }} />
                              <button onClick={(e) => { e.stopPropagation(); setData(p => ({ ...p, questionImageUrl: null })); saveToDb({ questionImageUrl: null }); }} className="absolute top-4 right-4 p-2 bg-white/90 backdrop-blur rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition-opacity md:opacity-100"><Trash2 size={16} className="text-red-500"/></button>
                            </div>
                          </div>
                        ) : (
                          /* CIRCULAR CAPTURE ZONE (MOBILE SNIPPET) */
                          <div className="relative group aspect-[4/3] md:aspect-auto md:h-64 rounded-full md:rounded-xl overflow-hidden bg-slate-50 flex flex-col items-center justify-center space-y-4 border-2 border-dashed border-slate-200 transition-all hover:border-blue-400">
                            <div className="z-10 flex flex-col items-center gap-4">
                              <button onClick={() => { setActiveUploadType('question'); fileInputRef.current?.click(); }} className="w-16 h-16 rounded-full bg-blue-700 flex items-center justify-center text-white shadow-xl ring-8 ring-blue-100/50 active:scale-95 transition-transform">
                                <ImageIcon size={28} />
                              </button>
                              <div className="text-center">
                                <p className="font-headline font-bold text-lg text-slate-900">Capture Question</p>
                                <p className="text-xs text-slate-400 font-medium uppercase tracking-wider">Scan or upload document</p>
                              </div>
                            </div>
                            <div className="absolute bottom-6 flex gap-3 z-10 md:hidden">
                              <button onClick={() => { setActiveUploadType('question'); fileInputRef.current?.click(); }} className="bg-white py-2 px-4 rounded-full text-[10px] font-bold uppercase tracking-wider text-slate-600 shadow-sm border border-slate-100 flex items-center gap-2 active:scale-95 transition-all">
                                <FileText size={14}/> Upload PDF
                              </button>
                              <button onClick={() => setIsQuestionTextMode(true)} className="bg-white py-2 px-4 rounded-full text-[10px] font-bold uppercase tracking-wider text-slate-600 shadow-sm border border-slate-100 flex items-center gap-2 active:scale-95 transition-all">
                                <Plus size={14}/> Type Text
                              </button>
                            </div>
                          </div>
                        )
                      )}
                    </div>

                    {/* Solution Toggle Area (MOBILE SNIPPET) */}
                    <div className="bg-slate-50 rounded-2xl p-6 space-y-4 border border-slate-200/60">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Verified size={18} className="text-blue-600" />
                          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-600">Solution Reference</span>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input type="checkbox" checked={isSolutionEnabled} onChange={(e) => setIsSolutionEnabled(e.target.checked)} className="sr-only peer" />
                          <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-700"></div>
                        </label>
                      </div>
                      {isSolutionEnabled && (
                        <div className="pt-2 animate-in fade-in slide-in-from-top-2 duration-300">
                          {isSolutionTextMode ? (
                            <textarea placeholder="Paste reference solution steps..." value={data.solutionText} onChange={(e) => setData(p => ({ ...p, solutionText: e.target.value }))} onBlur={(e) => saveToDb({ solutionText: e.target.value })} className="solution-input w-full min-h-[140px] bg-white rounded-xl p-4 text-sm border border-slate-200 focus:ring-2 focus:ring-blue-500/10 outline-none transition-all resize-none italic text-slate-600 font-serif leading-relaxed" />
                          ) : (
                            data.solutionImageUrl ? (
                              <div className="relative">
                                <img src={data.solutionImageUrl} alt="Solution" className="w-full rounded-xl border border-slate-200 shadow-sm" onClick={() => { setActiveUploadType('solution'); fileInputRef.current?.click(); }} />
                                <button onClick={() => { setData(p => ({ ...p, solutionImageUrl: null })); saveToDb({ solutionImageUrl: null }); }} className="absolute top-2 right-2 p-1.5 bg-white/90 backdrop-blur rounded-full text-red-500 shadow-sm"><Trash2 size={14}/></button>
                              </div>
                            ) : (
                              <button onClick={() => { setActiveUploadType('solution'); fileInputRef.current?.click(); }} className="w-full py-4 border-2 border-dashed border-slate-200 rounded-xl text-xs font-bold text-slate-400 uppercase tracking-widest hover:border-blue-400 transition-all">Add Solution Image</button>
                            )
                          )}
                        </div>
                      )}
                      <p className="text-[11px] text-slate-400 font-medium leading-relaxed">
                        Include your own solution to identify logical gaps and receive comparative analysis from Gemini.
                      </p>
                    </div>
                  </div>

                  {/* Submission Button */}
                  <div className="pt-4 flex flex-col items-center">
                    {(data.questionImageUrl || data.questionText) && status !== 'processing' && status !== 'ready' && (
                      <button onClick={handleProcessWithAI} className="w-full py-5 bg-gradient-to-r from-blue-700 to-blue-600 text-white rounded-full font-bold tracking-tight shadow-xl shadow-blue-200/50 flex items-center justify-center gap-3 hover:scale-[1.01] active:scale-95 transition-all group">
                        <Sparkles size={20} className="group-hover:rotate-12 transition-transform" />
                        <span>Submit to Gemini</span>
                      </button>
                    )}
                    {status === 'ready' && (
                      <button onClick={startNewQuestion} className="w-full py-4 border border-blue-200 rounded-full text-blue-600 font-bold flex items-center justify-center gap-2 hover:bg-blue-50 transition-all bg-white shadow-sm active:scale-95">
                        <Plus size={18}/> New Analysis
                      </button>
                    )}
                    {status === 'processing' && (
                      <div className="w-full py-5 bg-slate-900 text-white rounded-full font-bold flex flex-col items-center gap-2">
                        <Loader2 className="animate-spin" size={20} />
                        <span className="text-[10px] uppercase tracking-[0.2em] opacity-60 font-black">{aiStep}</span>
                      </div>
                    )}
                  </div>
                </section>

                {/* Right: Output Column */}
                <section className="w-full md:w-[40%] p-6 md:p-10 bg-slate-50/50 border-t md:border-t-0 md:border-l border-slate-200/60 overflow-y-auto scrollbar-hide">
                  <div className="space-y-8">
                    {/* Meta Cards (Desktop Only Labels) */}
                    <div className="hidden md:grid grid-cols-12 gap-5">
                      <div className="col-span-4 bg-white rounded-xl p-5 shadow-sm border border-slate-200/60">
                        <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Subject</label>
                        <input className="w-full border-none p-0 font-body font-bold text-slate-900 focus:ring-0 text-sm bg-transparent" type="text" value={extractSubject || 'Physics'} onChange={(e) => setExtractSubject(e.target.value)} />
                      </div>
                      <div className="col-span-8 bg-white rounded-xl p-5 shadow-sm border border-slate-200/60">
                        <div className="flex justify-between items-center mb-2">
                          <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Target Level</label>
                          <ChevronUp size={14} className="text-slate-300" />
                        </div>
                        <div className="flex gap-1.5 p-1 bg-slate-100 rounded-lg">
                          {['Primary', 'Secondary', 'JC', 'University'].map((lvl) => (
                            <button key={lvl} onClick={() => setExtractLevel(lvl)} className={`flex-1 py-1.5 text-[10px] font-bold rounded-md transition-all ${extractLevel.includes(lvl) ? 'bg-white shadow-sm text-blue-700' : 'text-slate-400 hover:text-slate-600'}`}>
                              {lvl}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="space-y-6">
                      <div className="flex items-center gap-3 border-b border-slate-200/30 pb-2">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-600">Active Variations</span>
                        {status === 'ready' && <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded text-[10px] font-bold uppercase">{data.variations.length} Generated</span>}
                      </div>

                      {status === 'ready' ? (
                        <div className="space-y-4">
                          {data.variations.map((v, i) => (
                            <div key={i} className={`bg-white rounded-2xl shadow-sm border transition-all ${showSolutions[i] ? 'border-blue-200 ring-1 ring-blue-50' : 'border-slate-200/60'}`}>
                              <div className="p-5 flex justify-between items-start" onClick={() => setShowSolutions(p => ({ ...p, [i]: !p[i] }))}>
                                <div className="space-y-1">
                                  <span className="text-[10px] font-bold uppercase tracking-wider text-blue-600">{v.category}</span>
                                  <h3 className="font-headline font-bold text-lg text-slate-900 line-clamp-1">Analysis Path {i + 1}</h3>
                                </div>
                                <button className="text-slate-400">
                                  {showSolutions[i] ? <ChevronUp size={20}/> : <ChevronDown size={20}/>}
                                </button>
                              </div>
                              
                              <div className={`px-5 pb-5 space-y-4 transition-all ${showSolutions[i] ? 'block' : 'hidden'}`}>
                                <div className="font-body text-sm leading-relaxed text-slate-700 prose prose-blue max-w-none">
                                  <Latex>{v.text}</Latex>
                                </div>
                                <div className="pt-4 border-t border-slate-50 space-y-3">
                                  <div className="p-4 bg-slate-50 rounded-xl text-xs italic font-serif leading-relaxed text-slate-600 border border-slate-100">
                                    <Latex>{v.solution}</Latex>
                                  </div>
                                  <div className="flex gap-4 pt-2">
                                    <button className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-blue-700 active:scale-95 transition-all">
                                      Copy Question <ChevronRight size={12}/>
                                    </button>
                                    <button className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                                      Share <Share2 size={12}/>
                                    </button>
                                  </div>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="py-24 flex flex-col items-center justify-center space-y-4 opacity-20">
                          <Terminal size={48} className="text-slate-300" />
                          <p className="font-bold text-[10px] uppercase tracking-[0.4em] text-slate-400">Awaiting content</p>
                        </div>
                      )}
                    </div>
                  </div>
                </section>
              </div>
            )
          ) : (
            /* EXTRACTOR VIEW (Preserved & Mobile Optimized) */
            <div className="flex flex-col md:flex-row h-full overflow-hidden">
              <section className="w-full md:w-1/2 p-6 md:p-10 bg-white border-b md:border-b-0 md:border-r border-slate-200/50 overflow-y-auto scrollbar-hide space-y-8 md:space-y-10">
                <header>
                  <span className="label-style text-[10px] font-bold uppercase tracking-widest text-blue-600">Extraction Engine</span>
                  <h2 className="font-headline text-2xl md:text-3xl font-bold text-slate-900 mt-1">Question Extractor</h2>
                  <p className="text-sm text-slate-500 mt-2 italic font-medium">Paste lecture notes or transcripts to synthesize questions.</p>
                </header>

                <div className="space-y-6">
                  <div className="relative group">
                    <textarea placeholder="Paste the scholarly text here..." value={extractContent} onChange={(e) => setExtractContent(e.target.value)} className="w-full min-h-[250px] md:min-h-[350px] p-5 bg-slate-50 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-blue-500/10 outline-none transition-all text-sm leading-relaxed resize-none font-body italic" />
                    <div className="absolute bottom-4 right-4 flex items-center gap-2 text-slate-400 text-[10px] font-bold uppercase tracking-wider">
                      <FileText size={12}/> {extractContent.split(/\s+/).filter(x => x).length} words
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Subject</label>
                      <select value={extractSubject} onChange={(e) => setExtractSubject(e.target.value)} className="w-full p-3 bg-slate-50 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500/10 outline-none transition-all font-bold text-xs appearance-none">
                        <option>Literature</option><option>Quantum Ethics</option><option>History</option><option>Philosophy</option>
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Level</label>
                      <select value={extractLevel} onChange={(e) => { setExtractLevel(e.target.value); localStorage.setItem('qb_extract_level', e.target.value); }} className="w-full p-3 bg-slate-50 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500/10 outline-none transition-all font-bold text-xs appearance-none">
                        <option>Undergraduate</option><option>Post-Doctoral</option><option>Scholarly</option><option>Archival</option>
                      </select>
                    </div>
                  </div>

                  <button onClick={handleExtract} disabled={isExtracting || !extractContent.trim()} className={`w-full py-4 rounded-xl font-bold text-sm flex items-center justify-center gap-3 transition-all shadow-lg shadow-blue-100 ${isExtracting || !extractContent.trim() ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-gradient-to-r from-blue-700 to-blue-600 text-white active:scale-[0.98]'}`}>
                    {isExtracting ? <Loader2 className="animate-spin" size={18}/> : <Sparkles size={18}/>}
                    {isExtracting ? 'Analyzing Corpus...' : 'Generate Questions'}
                  </button>
                </div>
              </section>

              <section className="w-full md:w-1/2 p-6 md:p-10 bg-slate-50/50 overflow-y-auto scrollbar-hide">
                <div className="max-w-2xl mx-auto space-y-10">
                  {extractConceptTree.length > 0 && (
                    <div className="bg-[#12141d] rounded-2xl p-6 shadow-2xl relative overflow-hidden group">
                      <div className="flex items-center gap-4 mb-4 border-b border-white/5 pb-3">
                        <div className="flex gap-1.5">
                          <div className="w-2 h-2 rounded-full bg-red-500/40"></div>
                          <div className="w-2 h-2 rounded-full bg-green-500/40"></div>
                        </div>
                        <span className="text-[9px] font-mono text-slate-500 uppercase tracking-widest">Logic_Map.vsh</span>
                      </div>
                      <div className="font-mono text-[10px] leading-relaxed text-blue-200/80 space-y-2 whitespace-pre">
                        <Latex>{extractConceptTree.join('\n')}</Latex>
                      </div>
                    </div>
                  )}

                  <div className="space-y-6">
                    {extractedQuestions.length > 0 ? (
                      <div className="relative group">
                        <div className="bg-white rounded-3xl p-8 border border-slate-200/60 shadow-xl shadow-slate-900/5 min-h-[320px] flex flex-col justify-center text-center">
                          <div className="w-12 h-12 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-6">
                            <BrainCircuit size={24} className="text-blue-700" />
                          </div>
                          <div className="font-headline text-lg italic leading-relaxed text-slate-900">
                            <Latex>{extractedQuestions[currentExtractIdx].question}</Latex>
                          </div>
                          <div className="mt-8 pt-6 border-t border-slate-50 flex flex-wrap justify-center gap-2">
                            <span className="px-3 py-1 bg-slate-100 rounded-full text-[9px] font-bold uppercase text-slate-500">Conceptual</span>
                            <span className="px-3 py-1 bg-slate-100 rounded-full text-[9px] font-bold uppercase text-slate-500">{extractLevel}</span>
                          </div>
                        </div>
                        
                        <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-4 bg-white p-2 rounded-full shadow-lg border border-slate-100 ring-4 ring-slate-50">
                          <button onClick={() => setCurrentExtractIdx(prev => Math.max(0, prev - 1))} disabled={currentExtractIdx === 0} className="w-10 h-10 rounded-full flex items-center justify-center bg-slate-50 text-slate-600 active:scale-90 disabled:opacity-30">
                            <ChevronLeft size={20}/>
                          </button>
                          <div className="h-4 w-px bg-slate-200 mx-1"></div>
                          <button onClick={() => setCurrentExtractIdx(prev => Math.min(extractedQuestions.length - 1, prev + 1))} disabled={currentExtractIdx === extractedQuestions.length - 1} className="w-10 h-10 rounded-full flex items-center justify-center bg-blue-700 text-white active:scale-90 disabled:opacity-30">
                            <ChevronRight size={20}/>
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="py-20 flex flex-col items-center justify-center space-y-4 opacity-10">
                        <Terminal size={48} className="text-slate-400" />
                        <p className="font-black text-[10px] uppercase tracking-[0.4em]">Awaiting Content</p>
                      </div>
                    )}
                  </div>
                </div>
              </section>
            </div>
          )}
        </main>

        {/* MOBILE BOTTOM NAV */}
        <nav className="md:hidden fixed bottom-0 left-0 w-full flex justify-around items-center px-4 pb-safe pt-2 bg-white/90 backdrop-blur-md border-t border-slate-200/20 z-50">
          <button onClick={() => setActiveMode('breaker')} className={`flex flex-col items-center justify-center px-3 py-2 transition-all active:scale-90 ${activeMode === 'breaker' ? 'text-blue-700 bg-blue-50/50 rounded-xl' : 'text-slate-400'}`}>
            <BrainCircuit size={20} />
            <span className="text-[10px] font-bold uppercase tracking-widest mt-1">Breaker</span>
          </button>
          <button onClick={() => setActiveMode('extractor')} className={`flex flex-col items-center justify-center px-3 py-2 transition-all active:scale-90 ${activeMode === 'extractor' ? 'text-blue-700 bg-blue-50/50 rounded-xl' : 'text-slate-400'}`}>
            <Sparkles size={20} />
            <span className="text-[10px] font-bold uppercase tracking-widest mt-1">Extractor</span>
          </button>
          <button onClick={() => setShowHistory(true)} className="flex flex-col items-center justify-center text-slate-400 px-3 py-2 transition-all active:scale-90">
            <History size={20} />
            <span className="text-[10px] font-bold uppercase tracking-widest mt-1">History</span>
          </button>
          <button className="flex flex-col items-center justify-center text-slate-400 px-3 py-2 transition-all active:scale-90">
            <Settings size={20} />
            <span className="text-[10px] font-bold uppercase tracking-widest mt-1">Settings</span>
          </button>
        </nav>
      </div>
      <input type="file" accept="image/*" className="hidden" ref={fileInputRef} onChange={(e) => onSelectFile(e, activeUploadType)} />
    </div>
  );
}

            /* EXTRACTOR VIEW */
            <div className="flex-1 flex overflow-hidden">
              {/* Left: Extract Inputs */}
              <section className="w-1/2 p-10 bg-white border-r border-slate-200/50 overflow-y-auto scrollbar-hide space-y-10">
                <header>
                  <div className="flex items-center gap-2 text-blue-600 mb-2">
                    <GraduationCap size={18} />
                    <span className="text-[10px] font-black uppercase tracking-[0.2em]">Premium Extractor</span>
                  </div>
                  <h2 className="font-headline text-3xl font-bold text-slate-900">Source Material</h2>
                  <p className="text-sm text-slate-500 mt-2">Paste lecture notes or transcripts to synthesize questions.</p>
                </header>

                <div className="space-y-6">
                  <div className="relative group">
                    <textarea placeholder="Paste your study material here..." value={extractContent} onChange={(e) => setExtractContent(e.target.value)} className="w-full min-h-[350px] p-6 bg-[#fafafa] rounded-2xl border border-slate-200 focus:ring-2 focus:ring-blue-500/10 outline-none transition-all text-base leading-relaxed resize-none font-body shadow-inner" />
                    <div className="absolute bottom-4 right-4 flex items-center gap-2 text-slate-400 text-[10px] font-bold uppercase tracking-wider">
                      <FileText size={12}/> {extractContent.split(/\s+/).filter(x => x).length} words
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Subject</label>
                      <input type="text" placeholder="e.g. Molecular Biology" value={extractSubject} onChange={(e) => setExtractSubject(e.target.value)} className="w-full p-4 bg-slate-50 rounded-xl border border-slate-100 focus:ring-2 focus:ring-blue-500/10 outline-none transition-all font-bold text-sm" />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Target Level</label>
                      <select value={extractLevel} onChange={(e) => { setExtractLevel(e.target.value); localStorage.setItem('qb_extract_level', e.target.value); }} className="w-full p-4 bg-slate-50 rounded-xl border border-slate-100 focus:ring-2 focus:ring-blue-500/10 outline-none transition-all font-bold text-sm appearance-none cursor-pointer">
                        <option>Primary School</option><option>Secondary School</option><option>Junior College</option><option>University</option>
                      </select>
                    </div>
                  </div>

                  <button onClick={handleExtract} disabled={isExtracting || !extractContent.trim()} className={`w-full py-5 rounded-xl font-bold text-sm flex items-center justify-center gap-3 transition-all shadow-xl shadow-blue-100 ${isExtracting || !extractContent.trim() ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-slate-900 text-white hover:bg-black active:scale-[0.98]'}`}>
                    {isExtracting ? <Loader2 className="animate-spin" size={18}/> : <Sparkles size={18} className="text-blue-400"/>}
                    {isExtracting ? 'Analyzing Corpus...' : 'Synthesize Questions'}
                  </button>
                </div>
              </section>

              {/* Right: Extracted Questions Viewer */}
              <section className="w-1/2 p-10 bg-[#f5f3f4] overflow-y-auto scrollbar-hide">
                <div className="max-w-2xl mx-auto space-y-10">
                  {/* TERMINAL CONCEPT BREAKDOWN */}
                  {extractConceptTree.length > 0 && (
                    <div className="bg-[#12141d] rounded-2xl p-8 shadow-2xl relative overflow-hidden group animate-in fade-in slide-in-from-top-4 duration-500">
                      <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/10 blur-3xl rounded-full"></div>
                      <div className="flex items-center gap-4 mb-6 border-b border-white/5 pb-4">
                        <div className="flex gap-1.5">
                          <div className="w-2 h-2 rounded-full bg-red-500/40"></div>
                          <div className="w-2 h-2 rounded-full bg-yellow-500/40"></div>
                          <div className="w-2 h-2 rounded-full bg-green-500/40"></div>
                        </div>
                        <span className="text-[9px] font-mono text-slate-500 uppercase tracking-widest">Logic_Map.vsh</span>
                      </div>
                      <div className="font-mono text-xs leading-relaxed text-blue-200/80 space-y-2 whitespace-pre">
                        <Latex>{extractConceptTree.join('\n')}</Latex>
                      </div>
                    </div>
                  )}

                  <header className="flex justify-between items-center">
                    <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-300">Extracted Results</h3>
                    <span className="px-3 py-1 bg-white rounded-full text-[10px] font-black text-blue-600 shadow-sm">{extractedQuestions.length} Questions</span>
                  </header>

                  <div className="space-y-6">
                    {allConceptsTested && (
                      <div className="bg-green-50 border border-green-100 p-6 rounded-2xl flex items-center gap-4 animate-in zoom-in-95 duration-500 shadow-sm">
                        <div className="w-10 h-10 rounded-full bg-green-500 flex items-center justify-center text-white shrink-0 shadow-lg shadow-green-200"><Verified size={20} /></div>
                        <div>
                          <p className="text-[10px] font-black uppercase text-green-700 tracking-wider">Full Coverage Achieved</p>
                          <p className="text-[10px] text-green-600 font-bold opacity-80 leading-relaxed">Gemini has confirmed that all core concepts are tested.</p>
                        </div>
                      </div>
                    )}

                    {extractedQuestions.length > 0 ? (
                      <>
                        <div className="bg-white rounded-2xl p-10 border border-slate-200/50 shadow-sm min-h-[450px] flex flex-col justify-between animate-in fade-in slide-in-from-right-4 duration-500">
                          <div className="space-y-8">
                            <div className="flex justify-between items-center">
                              <span className="px-3 py-1 bg-slate-900 text-white text-[10px] font-black uppercase rounded tracking-wider">{extractedQuestions[currentExtractIdx].type}</span>
                              <span className="text-[10px] font-black text-slate-300 uppercase tracking-widest">Question {currentExtractIdx + 1} / {extractedQuestions.length}</span>
                            </div>
                            <div className="text-xl font-medium leading-relaxed prose prose-blue max-w-none text-slate-800">
                              <Latex>{extractedQuestions[currentExtractIdx].question}</Latex>
                            </div>
                            {extractedQuestions[currentExtractIdx].options && extractedQuestions[currentExtractIdx].options.length > 0 && (
                              <div className="grid gap-3 pt-4 pl-4 border-l-2 border-blue-50">
                                {extractedQuestions[currentExtractIdx].options.map((opt, oIdx) => (
                                  <div key={oIdx} className="text-sm text-slate-600 font-medium py-1 px-3 bg-slate-50/50 rounded-lg"><Latex>{opt}</Latex></div>
                                ))}
                              </div>
                            )}
                          </div>

                          <div className="pt-8 border-t border-slate-100">
                            <button onClick={() => setShowExtractedSolutions(p => ({ ...p, [currentExtractIdx]: !p[currentExtractIdx] }))} className="flex items-center gap-2 text-sm font-bold text-blue-600 hover:text-blue-800 transition-all">
                              {showExtractedSolutions[currentExtractIdx] ? <EyeOff size={16} /> : <Eye size={16} />}
                              {showExtractedSolutions[currentExtractIdx] ? 'Hide Solution' : 'Show Pedagogical Solution'}
                            </button>
                            {showExtractedSolutions[currentExtractIdx] && (
                              <div className="mt-4 p-6 bg-blue-50/30 rounded-xl border border-blue-100/50 animate-in zoom-in-95 duration-200">
                                <div className="text-[10px] font-black text-blue-500 uppercase tracking-widest mb-4 flex items-center gap-2">
                                  <span className="w-1 h-1 rounded-full bg-blue-500"></span> Final Answer Path
                                </div>
                                <div className="text-sm font-bold text-slate-700 mb-3"><Latex>{extractedQuestions[currentExtractIdx].answer}</Latex></div>
                                <div className="prose prose-blue text-sm text-slate-600 italic leading-relaxed"><Latex>{extractedQuestions[currentExtractIdx].solution}</Latex></div>
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="flex gap-4">
                          <button onClick={() => setCurrentExtractIdx(prev => Math.max(0, prev - 1))} disabled={currentExtractIdx === 0} className="flex-1 py-4 bg-white border border-slate-200 rounded-xl font-bold text-[10px] uppercase tracking-widest text-slate-400 hover:text-blue-600 hover:border-blue-600 transition-all flex items-center justify-center gap-2 disabled:opacity-30"><ChevronLeft size={16}/> Previous</button>
                          <button onClick={() => setCurrentExtractIdx(prev => Math.min(extractedQuestions.length - 1, prev + 1))} disabled={currentExtractIdx === extractedQuestions.length - 1} className="flex-1 py-4 bg-white border border-slate-200 rounded-xl font-bold text-[10px] uppercase tracking-widest text-slate-400 hover:text-blue-600 hover:border-blue-600 transition-all flex items-center justify-center gap-2 disabled:opacity-30">Next <ChevronRight size={16}/></button>
                        </div>

                        {currentExtractIdx === extractedQuestions.length - 1 && (
                          <button onClick={handleMoreQuestions} disabled={isAddingMore} className={`w-full py-4 mt-2 border-2 border-dashed border-slate-200 rounded-2xl text-slate-400 font-bold text-[10px] uppercase tracking-widest hover:border-blue-400 hover:text-blue-600 transition-all flex items-center justify-center gap-2 ${isAddingMore ? 'opacity-50' : ''}`}>
                            {isAddingMore ? <Loader2 className="animate-spin" size={14}/> : <Plus size={14}/>}
                            {isAddingMore ? 'Extending Analysis...' : 'Generate Additional Questions'}
                          </button>
                        )}
                      </>
                    ) : (
                      <div className="py-20 flex flex-col items-center justify-center space-y-4 opacity-10">
                        <Terminal size={48} className="text-slate-400" />
                        <p className="font-black text-[10px] uppercase tracking-[0.4em]">Awaiting Content</p>
                      </div>
                    )}
                  </div>
                </div>
              </section>
            </div>
          )}
        </main>
      </div>
      <input type="file" accept="image/*" className="hidden" ref={fileInputRef} onChange={(e) => onSelectFile(e, activeUploadType)} />
      
      {/* GLOBAL DIAGNOSTICS (Preserved) */}
      {debugLog && (
        <div className="fixed bottom-4 right-4 max-w-xs bg-red-900 text-white p-4 rounded-xl shadow-2xl text-[10px] font-mono z-[100] animate-in slide-in-from-bottom-2">
          <div className="flex justify-between items-center mb-2 border-b border-white/20 pb-1">
            <span className="font-bold">SYSTEM DIAGNOSTIC</span>
            <button onClick={() => setDebugLog('')}><X size={10}/></button>
          </div>
          {debugLog}
        </div>
      )}
    </div>
  );
}

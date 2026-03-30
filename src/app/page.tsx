'use client';

import { useState, useEffect, useRef } from 'react';
import { Columns2, Smartphone, ChevronRight, Eye, EyeOff, Loader2, X, BrainCircuit, Trash2, Upload, PlusCircle, ChevronDown, ChevronUp, LogOut, History, Plus, FileText, ImageIcon, Sparkles, ChevronLeft, GraduationCap } from 'lucide-react';
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

  // --- 1. BOOTSTRAP & MIRROR SYNC ---

  useEffect(() => {
    const bootstrap = async () => {
      await supabase.auth.signInAnonymously();
      const savedRoomId = localStorage.getItem('qb_active_room_id');
      const savedCode = localStorage.getItem('qb_pairing_code');
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

    // Global Paste Handler for Images
    const handleGlobalPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          const file = items[i].getAsFile();
          if (file) {
            e.preventDefault(); // Stop default behavior for image pastes
            
            // Determine target based on focus
            let targetType = activeUploadType;
            if (document.activeElement?.classList.contains('question-input')) {
              targetType = 'question';
            } else if (document.activeElement?.classList.contains('solution-input')) {
              targetType = 'solution';
            }
            
            setActiveUploadType(targetType);
            setRawFile(file);
            const reader = new FileReader();
            reader.onload = () => {
              setImgSrc(reader.result?.toString() || '');
              setStatus('cropping');
            };
            reader.readAsDataURL(file);
          }
        }
      }
    };

    window.addEventListener('paste', handleGlobalPaste);
    return () => window.removeEventListener('paste', handleGlobalPaste);
  }, [activeUploadType]); // Re-bind if upload type changes or just rely on closure if stable

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
    if (qData) {
      updateLocalState(qData);
    }
  };

  const updateLocalState = (newData: any, isRemote = false) => {
    // Only update local ID and content, but preserve the active mode if we are typing
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
    
    // Remote mode syncing only if not local
    if (isRemote) {
       // We only sync modes if the status changes to processing (Gemini was triggered)
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

  // --- 2. ROOM ACTIONS ---

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
    } catch (err: any) {
      alert("Error: " + err.message);
    }
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
    setData({
      questionImageUrl: null,
      questionText: '',
      solutionImageUrl: null,
      solutionText: '',
      extractedText: '',
      variations: []
    });
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
        body: JSON.stringify({
          mode: 'extract',
          extractContent,
          subject: extractSubject,
          level: extractLevel
        })
      });
      const result = await resp.json();
      if (result.questions) {
        setExtractedQuestions(result.questions);
        setExtractConceptTree(result.conceptTree || []);
        setAllConceptsTested(!!result.allConceptsTested);
      } else if (result.error) {
        alert("Extraction Error: " + result.error);
      }
    } catch (err: any) {
      alert("Network Error: " + err.message);
    } finally {
      setIsExtracting(false);
    }
  };

  const handleMoreQuestions = async () => {
    if (!extractContent.trim() || isAddingMore) return;
    setIsAddingMore(true);

    try {
      const resp = await fetch('/api/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'extract',
          extractContent,
          subject: extractSubject,
          level: extractLevel,
          existingQuestions: extractedQuestions
        })
      });
      const result = await resp.json();
      if (result.questions) {
        setExtractedQuestions(prev => [...prev, ...result.questions]);
        if (result.conceptTree) setExtractConceptTree(result.conceptTree);
        setAllConceptsTested(!!result.allConceptsTested);
      } else if (result.error) {
        alert("Expansion Error: " + result.error);
      }
    } catch (err: any) {
      alert("Network Error: " + err.message);
    } finally {
      setIsAddingMore(false);
    }
  };

  // --- 3. DATABASE UPDATES ---

  const saveToDb = async (updates: Partial<QuestionData>, newStatus?: string) => {
    if (!roomId) return null;
    
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      const { data: authData, error: authError } = await supabase.auth.signInAnonymously();
      if (authError) { setDebugLog(`Auth Error: ${authError.message}`); return null; }
    }

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
        if (error) { setDebugLog(`DB Update Error: ${error.message}`); return null; }
        return data.id;
      } else { 
        const { data: created, error } = await supabase.from('questions').insert([payload]).select().single(); 
        if (error) { setDebugLog(`DB Insert Error: ${error.message}`); return null; }
        if (created) { setData(p => ({ ...p, id: created.id })); return created.id; }
      }
    } catch (err: any) { setDebugLog(`Local state crash: ${err.message}`); }
    return null;
  };

  // --- 4. CORE AI HANDLER ---

  const handleProcessWithAI = async () => {
    if (!roomId) return;
    setStatus('processing');
    setAiStep('AI Engine Initializing...');
    setDebugLog('');

    const currentQuestionId = await saveToDb({
       isQuestionTextMode,
       isSolutionTextMode
    }, 'processing');

    if (!currentQuestionId) {
      setAiStep('Initialization Failed');
      setTimeout(() => setStatus('waiting'), 4000);
      return;
    }

    try {
      const hasImages = (!isQuestionTextMode && data.questionImageUrl) || (isSolutionEnabled && !isSolutionTextMode && data.solutionImageUrl);
      setAiStep(hasImages ? 'Processing Images & OCR...' : 'Analyzing Question Text...');
      
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

      setAiStep('Generating Variations...');
      const result = await resp.json();
      
      if (result.error) {
        setAiStep('AI Error: ' + result.error);
        if (result.raw) setDebugLog(result.raw);
        await saveToDb({}, 'waiting');
        return;
      }

      setAiStep('Finalizing Results...');
      const { error: updateError } = await supabase.from('questions').update({
        extracted_text: result.extractedText,
        variations: result.variations,
        status: 'ready'
      }).eq('id', currentQuestionId);

      if (updateError) setAiStep('DB Save Failed');
      else { setAiStep('Success!'); setStatus('ready'); fetchHistory(roomId); }

    } catch (err: any) { setAiStep('Network Failure'); await saveToDb({}, 'waiting'); setTimeout(() => setStatus('waiting'), 3000); }
  };

  // --- 5. MEDIA HELPERS ---

  const uploadToSupabase = async (file: File, type: ImageType) => {
    try {
      const fileName = `${roomId}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.]/g, '_')}`;
      const { error } = await supabase.storage.from('questions').upload(fileName, file);
      if (error) throw error;
      const { data: { publicUrl } } = supabase.storage.from('questions').getPublicUrl(fileName);
      
      const updates = type === 'question' ? { questionImageUrl: publicUrl } : { solutionImageUrl: publicUrl };
      await saveToDb(updates, 'waiting');
      setStatus('waiting'); setImgSrc('');
    } catch (err: any) { alert('Upload failed: ' + err.message); setStatus('waiting'); }
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

  if (isInitializing) return <div className="min-h-screen bg-slate-50 flex items-center justify-center"><Loader2 className="animate-spin text-indigo-600" /></div>;

  return (
    <div className="min-h-screen bg-slate-50 flex text-slate-900 font-sans overflow-hidden">
      {/* RETRACTABLE SIDEBAR */}
      <aside className={`bg-slate-900 text-white transition-all duration-300 flex flex-col z-50 ${sidebarOpen ? 'w-64' : 'w-20'}`}>
        <div className="p-6 flex items-center justify-between">
          {sidebarOpen && <h1 className="font-black italic text-xl text-indigo-400">QB.</h1>}
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="p-2 hover:bg-slate-800 rounded-lg transition-colors mx-auto">
            {sidebarOpen ? <ChevronLeft size={20} /> : <ChevronRight size={20} />}
          </button>
        </div>

        <nav className="flex-1 px-3 space-y-2 mt-4">
          <button 
            onClick={() => setActiveMode('breaker')}
            className={`w-full flex items-center gap-4 p-4 rounded-xl transition-all ${activeMode === 'breaker' ? 'bg-indigo-600 shadow-lg shadow-indigo-900/50' : 'hover:bg-slate-800 text-slate-400'}`}
          >
            <BrainCircuit size={24} className="shrink-0" />
            {sidebarOpen && <span className="font-bold text-sm uppercase tracking-widest text-left">Breaker</span>}
          </button>

          <button 
            onClick={() => setActiveMode('extractor')}
            className={`w-full flex items-center gap-4 p-4 rounded-xl transition-all ${activeMode === 'extractor' ? 'bg-indigo-600 shadow-lg shadow-indigo-900/50' : 'hover:bg-slate-800 text-slate-400'}`}
          >
            <Sparkles size={24} className="shrink-0" />
            {sidebarOpen && <span className="font-bold text-sm uppercase tracking-widest text-left">Extractor</span>}
          </button>
        </nav>

        <div className="p-6 border-t border-slate-800">
          <button onClick={resetSession} className="flex items-center gap-4 text-slate-500 hover:text-red-400 transition-colors w-full">
            <LogOut size={20} className="shrink-0" />
            {sidebarOpen && <span className="text-xs font-bold uppercase tracking-widest">Logout</span>}
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col relative overflow-hidden">
        {/* GLOBAL CROP OVERLAY */}
        {status === 'cropping' && imgSrc && (
          <div className="fixed inset-0 z-[100] bg-slate-900 flex flex-col">
            <div className="p-4 flex justify-between items-center text-white bg-slate-950"><button onClick={() => setStatus('waiting')}><X /></button><span className="font-bold text-xs uppercase">Crop {activeUploadType}</span><button onClick={handleConfirmCrop} className="bg-indigo-600 px-6 py-2 rounded-full font-black text-xs uppercase shadow-lg">Confirm</button></div>
            <div className="flex-1 overflow-auto bg-black flex items-center justify-center p-4"><ReactCrop crop={crop} onChange={c => setCrop(c)} onComplete={c => setCompletedCrop(c)} className="max-h-full"><img ref={imgRef} src={imgSrc} alt="Crop" className="max-w-full max-h-[70vh] object-contain" /></ReactCrop></div>
            <div className="p-4 bg-slate-950 text-center"><button onClick={() => { if (rawFile) uploadToSupabase(rawFile, activeUploadType); }} className="w-full max-w-xs p-3 bg-white/5 text-slate-400 text-[10px] font-black uppercase rounded-xl border border-white/10">Skip Crop & Upload</button></div>
          </div>
        )}

        {/* SESSION HISTORY SIDEBAR */}
        {showHistory && (
          <div className="fixed inset-0 z-[80] bg-slate-900/60 backdrop-blur-sm flex justify-end">
            <div className="w-full max-w-md bg-white h-full shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">
              <div className="p-6 border-b flex justify-between items-center">
                <h2 className="font-black uppercase tracking-widest text-sm flex items-center gap-2"><History size={18} className="text-indigo-600"/> Session History</h2>
                <button onClick={() => setShowHistory(false)}><X/></button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                <button onClick={startNewQuestion} className="w-full p-4 border-2 border-dashed border-indigo-100 rounded-2xl text-indigo-600 font-bold flex items-center justify-center gap-2 hover:bg-indigo-50 transition-all mb-4">
                  <Plus size={20}/> New Question
                </button>
                {history.map((item, idx) => (
                  <button key={idx} onClick={() => loadFromHistory(item)} className={`w-full text-left p-4 rounded-2xl border-2 transition-all group ${data.id === item.id ? 'border-indigo-600 bg-indigo-50' : 'border-slate-50 bg-slate-50/50 hover:border-slate-100'}`}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-[10px] font-black uppercase text-slate-400">{new Date(item.created_at!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      {item.status === 'ready' && <div className="w-1.5 h-1.5 rounded-full bg-green-500"></div>}
                    </div>
                    <p className="text-xs font-bold text-slate-600 line-clamp-2">{item.questionText || (item.questionImageUrl ? '[Question Image]' : 'Empty Question')}</p>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeMode === 'breaker' ? (
          !roomId ? (
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
              <div className="max-w-md w-full space-y-8 bg-white p-10 rounded-3xl shadow-xl border border-slate-100">
                <h1 className="text-4xl font-black text-indigo-600 italic">QB.</h1>
                <button onClick={createRoom} className="group flex items-center justify-between w-full p-6 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl transition-all shadow-lg shadow-indigo-200">
                  <div className="flex items-center gap-4 text-left"><Columns2 size={24} /><div className="font-bold text-lg">Start New Session</div></div>
                  <ChevronRight className="opacity-50" />
                </button>
                <div className="relative py-4 text-xs text-slate-400 uppercase tracking-widest flex items-center justify-center gap-4"><div className="h-px flex-1 bg-slate-100"></div>or join existing<div className="h-px flex-1 bg-slate-100"></div></div>
                <div className="space-y-3">
                  <input type="text" placeholder="Enter 6-digit Code" className="w-full p-4 rounded-xl border-2 border-slate-100 text-center font-mono text-xl uppercase tracking-widest focus:border-indigo-500 outline-none" onChange={(e) => setPairingCode(e.target.value.toUpperCase())} value={pairingCode} />
                  <button onClick={() => joinRoom(pairingCode)} className="w-full p-5 bg-indigo-600 text-white rounded-2xl font-black shadow-xl shadow-indigo-100 active:scale-95 transition-transform">Join Session</button>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col relative h-full">
              <header className="h-16 border-b bg-white flex items-center justify-between px-8 shrink-0 shadow-sm">
                <div className="flex items-center gap-3 font-black text-indigo-600 italic text-xl">Question Breaker</div>
                <div className="flex items-center gap-4">
                  <button onClick={() => setShowHistory(true)} className="flex items-center gap-2 px-4 py-1.5 bg-slate-100 rounded-full text-xs font-black text-slate-600 uppercase hover:bg-slate-200 transition-all">
                    <History size={16}/> History
                  </button>
                  <div className="px-4 py-1.5 bg-indigo-50 rounded-full text-sm font-mono font-bold text-indigo-600">CODE: {pairingCode}</div>
                </div>
              </header>
              
              <main className="flex-1 flex flex-col md:flex-row overflow-hidden text-left text-balance">
                <div className="w-full md:w-1/2 border-r bg-slate-50/50 flex flex-col relative overflow-y-auto pb-40">
                  <div className="p-8 space-y-10">
                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] flex items-center gap-2">The Question</h4>
                        <div className="flex items-center gap-3">
                          <button onClick={() => setIsQuestionTextMode(false)} className={`p-2 rounded-lg transition-all ${!isQuestionTextMode ? 'bg-indigo-600 text-white' : 'text-slate-400'}`}><ImageIcon size={16}/></button>
                          <button onClick={() => setIsQuestionTextMode(true)} className={`p-2 rounded-lg transition-all ${isQuestionTextMode ? 'bg-indigo-600 text-white' : 'text-slate-400'}`}><FileText size={16}/></button>
                        </div>
                      </div>
                      {isQuestionTextMode ? ( 
                        <textarea placeholder="Paste or type question here..." value={data.questionText} onChange={(e) => setData(p => ({ ...p, questionText: e.target.value }))} onBlur={(e) => saveToDb({ questionText: e.target.value })} className="question-input w-full min-h-[150px] bg-white rounded-2xl p-5 text-lg border-2 border-indigo-100 focus:border-indigo-500 outline-none transition-all shadow-sm whitespace-pre-wrap" /> 
                      ) : ( 
                        data.questionImageUrl ? <img src={data.questionImageUrl} alt="Question" className="w-full rounded-2xl shadow-xl border border-white mx-auto cursor-pointer" onClick={() => { setActiveUploadType('question'); fileInputRef.current?.click(); }} /> : ( <button onClick={() => { setActiveUploadType('question'); fileInputRef.current?.click(); }} className="w-full aspect-video bg-white/50 rounded-2xl border-2 border-dashed border-slate-200 flex flex-col items-center justify-center text-slate-300 space-y-2 hover:bg-white transition-all group"><Upload size={32} className="opacity-20 group-hover:scale-110 transition-transform" /><span className="text-xs font-bold uppercase tracking-widest text-center px-10">Upload Question Image</span></button> ) 
                      )}
                    </div>

                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <h4 className="text-[10px] font-black text-indigo-400 uppercase tracking-[0.2em] flex items-center gap-2">Solution Reference</h4>
                        <div className="flex items-center gap-2">
                           {isSolutionEnabled ? (
                             <div className="flex items-center gap-3">
                                <button onClick={() => setIsSolutionTextMode(false)} className={`p-2 rounded-lg transition-all ${!isSolutionTextMode ? 'bg-indigo-400 text-white' : 'text-indigo-200'}`}><ImageIcon size={16}/></button>
                                <button onClick={() => setIsSolutionTextMode(true)} className={`p-2 rounded-lg transition-all ${isSolutionTextMode ? 'bg-indigo-400 text-white' : 'text-indigo-200'}`}><FileText size={16}/></button>
                                <button onClick={() => { setIsSolutionEnabled(false); setData(p => ({ ...p, solutionImageUrl: null, solutionText: '' })); saveToDb({ solutionImageUrl: null, solutionText: '' }); }} className="text-slate-300 hover:text-red-500 ml-2"><Trash2 size={16}/></button>
                             </div>
                           ) : (
                            <button onClick={() => setIsSolutionEnabled(true)} className="text-[10px] font-black uppercase text-indigo-400 flex items-center gap-1"><PlusCircle size={14}/> Add Context</button>
                           )}
                        </div>
                      </div>
                      {isSolutionEnabled && (
                        isSolutionTextMode ? ( 
                          <textarea placeholder="Paste solution steps..." value={data.solutionText} onChange={(e) => setData(p => ({ ...p, solutionText: e.target.value }))} onBlur={(e) => saveToDb({ solutionText: e.target.value })} className="solution-input w-full min-h-[120px] bg-indigo-50/30 rounded-2xl p-5 text-sm border-2 border-indigo-50 focus:border-indigo-400 outline-none transition-all shadow-sm whitespace-pre-wrap" /> 
                        ) : ( 
                          data.solutionImageUrl ? <img src={data.solutionImageUrl} alt="Solution" className="w-full rounded-2xl shadow-lg border border-white opacity-80 mx-auto cursor-pointer" onClick={() => { setActiveUploadType('solution'); fileInputRef.current?.click(); }} /> : ( <button onClick={() => { setActiveUploadType('solution'); fileInputRef.current?.click(); }} className="w-full aspect-video bg-indigo-50/20 rounded-2xl border-2 border-dashed border-indigo-100 flex flex-col items-center justify-center text-indigo-300 space-y-2 hover:bg-white transition-all group"><Upload size={32} className="opacity-20 group-hover:scale-110 transition-transform" /><span className="text-xs font-bold uppercase tracking-widest text-center px-10">Upload Solution Image</span></button> ) 
                        )
                      )}
                    </div>
                    {debugLog && <div className="p-4 bg-red-50 rounded-2xl border border-red-100 text-[10px] font-mono text-red-600 overflow-auto max-h-40 whitespace-pre-wrap"><div className="font-bold uppercase mb-1">API Diagnostic:</div>{debugLog}</div>}
                  </div>

                  <div className="absolute bottom-0 left-0 right-0 p-8 bg-gradient-to-t from-slate-50 via-slate-50 to-transparent flex flex-col items-center">
                    {(data.questionImageUrl || data.questionText) && status !== 'processing' && status !== 'ready' && ( 
                       <button onClick={handleProcessWithAI} className="group bg-slate-900 hover:bg-black text-white px-12 py-5 rounded-full font-black text-xl shadow-2xl flex items-center gap-4 active:scale-95 transition-all shadow-indigo-100">
                         <BrainCircuit className="text-indigo-400 group-hover:rotate-12 transition-transform" />Submit to Gemini 3.1
                       </button> 
                    )}
                    {status === 'ready' && (
                      <button onClick={startNewQuestion} className="bg-white border-2 border-indigo-100 text-indigo-600 px-10 py-4 rounded-full font-black flex items-center gap-2 hover:bg-indigo-50 transition-all shadow-lg">
                        <Plus size={20}/> New Question
                      </button>
                    )}
                  </div>
                  {status === 'processing' && <div className="absolute inset-0 bg-white/80 backdrop-blur-sm flex flex-col items-center justify-center z-20 space-y-4 text-center"><Loader2 className="w-10 h-10 text-indigo-600 animate-spin" /><p className="font-bold text-indigo-950 uppercase tracking-widest text-xs">AI Logic Engine Active</p><p className="text-[10px] uppercase font-bold text-slate-400 animate-pulse bg-white px-3 py-1 rounded-full shadow-sm">{aiStep}</p></div>}
                </div>
                
                <div className="w-full md:w-1/2 bg-white flex flex-col overflow-y-auto">
                  <div className="p-4 border-b sticky top-0 bg-white/90 backdrop-blur z-10 flex justify-between items-center px-8">
                    <h3 className="text-sm font-bold uppercase tracking-widest text-slate-400 italic">Variations</h3>
                    <div className="bg-indigo-50 text-indigo-600 px-2 py-1 rounded text-[10px] font-black uppercase tracking-tighter">Gemini 3.1 Pro</div>
                  </div>
                  <div className="p-8 space-y-4 text-left">
                    {status === 'ready' ? (
                      data.variations.map((v, i) => (
                        <div key={i} className="border-2 border-slate-50 rounded-3xl overflow-hidden transition-all duration-300 hover:border-indigo-100">
                          <button onClick={() => setExpandedVariations(prev => ({ ...prev, [i]: !prev[i] }))} className={`w-full p-6 flex justify-between items-center transition-colors ${expandedVariations[i] ? 'bg-indigo-600 text-white shadow-lg' : 'bg-slate-50 text-slate-600 hover:bg-slate-100'}`}><div className="flex items-center gap-3"><span className={`text-[10px] font-black px-2 py-0.5 rounded uppercase tracking-wider ${expandedVariations[i] ? 'bg-white text-indigo-600' : 'bg-indigo-600 text-white'}`}>{v.category}</span><span className="font-bold text-sm tracking-tight">Expand Variation</span></div>{expandedVariations[i] ? <ChevronUp size={18} /> : <ChevronDown size={18} />}</button>
                          {expandedVariations[i] && ( <div className="p-8 space-y-6 animate-in slide-in-from-top-2 duration-300"><div className="text-slate-700 leading-relaxed text-lg prose prose-indigo whitespace-pre-wrap"><Latex>{v.text}</Latex></div><button onClick={() => setShowSolutions(p => ({ ...p, [i]: !p[i] }))} className="flex items-center gap-2 text-sm font-bold text-indigo-600 bg-indigo-50 px-4 py-2 rounded-full hover:bg-indigo-100 active:scale-95 transition-all shadow-sm">{showSolutions[i] ? <EyeOff size={16} /> : <Eye size={16} />} {showSolutions[i] ? 'Hide Solution' : 'Show Solution'}</button>{showSolutions[i] && <div className="mt-4 p-8 bg-slate-50 rounded-3xl border border-slate-100 text-slate-600 shadow-inner animate-in zoom-in-95"><div className="font-bold text-xs uppercase text-slate-400 mb-4 tracking-widest text-center">Pedagogical Solution</div><div className="prose prose-slate max-w-none whitespace-pre-wrap"><Latex>{v.solution}</Latex></div></div>}</div> )}
                        </div>
                      ))
                    ) : ( <div className="space-y-6 text-center py-20">{[1,2,3].map(i => <div key={i} className="space-y-3 animate-pulse opacity-20"><div className="h-4 w-24 bg-slate-100 rounded mx-auto"></div><div className="h-20 w-full bg-slate-50 rounded-2xl"></div></div>)}<p className="text-[10px] font-black text-slate-200 uppercase tracking-widest mt-4">Awaiting AI Logic</p></div> )}
                  </div>
                </div>
              </main>
              <input type="file" accept="image/*" className="hidden" ref={fileInputRef} onChange={(e) => onSelectFile(e, activeUploadType)} />
            </div>
          )
        ) : (
          /* QUESTION EXTRACTOR VIEW */
          <div className="flex-1 flex flex-col relative h-full bg-slate-50">
            <header className="h-16 border-b bg-white flex items-center justify-between px-8 shrink-0 shadow-sm">
              <div className="flex items-center gap-3 font-black text-indigo-600 italic text-xl">Question Extractor</div>
              <div className="flex items-center gap-2 bg-indigo-50 px-3 py-1 rounded-full">
                <GraduationCap size={16} className="text-indigo-600" />
                <span className="text-[10px] font-black uppercase text-indigo-600 tracking-tighter">Educator Mode</span>
              </div>
            </header>

            <main className="flex-1 flex flex-col md:flex-row overflow-hidden">
              <div className="w-full md:w-1/2 border-r bg-white p-8 overflow-y-auto space-y-8">
                <div className="space-y-3">
                  <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Source Material</h4>
                  <textarea placeholder="Paste your notes, lecture text, or content here..." value={extractContent} onChange={(e) => setExtractContent(e.target.value)} className="w-full min-h-[300px] p-6 bg-slate-50 rounded-3xl border-2 border-slate-100 focus:border-indigo-500 outline-none transition-all text-lg shadow-inner resize-none" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-3">
                    <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Subject / Module</h4>
                    <input type="text" placeholder="e.g. GEA1000" value={extractSubject} onChange={(e) => setExtractSubject(e.target.value)} className="w-full p-4 bg-slate-50 rounded-2xl border-2 border-slate-100 focus:border-indigo-500 outline-none transition-all font-bold" />
                  </div>
                  <div className="space-y-3">
                    <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Target Level</h4>
                    <select value={extractLevel} onChange={(e) => setExtractLevel(e.target.value)} className="w-full p-4 bg-slate-50 rounded-2xl border-2 border-slate-100 focus:border-indigo-500 outline-none transition-all font-bold">
                      <option>Primary School</option><option>Secondary School</option><option>Junior College</option><option>University</option>
                    </select>
                  </div>
                </div>
                <button onClick={handleExtract} disabled={isExtracting || !extractContent.trim()} className={`w-full py-5 rounded-2xl font-black text-lg flex items-center justify-center gap-3 transition-all shadow-xl ${isExtracting || !extractContent.trim() ? 'bg-slate-200 text-slate-400 cursor-not-allowed' : 'bg-slate-900 text-white hover:bg-black active:scale-[0.98] shadow-indigo-200'}`}>
                  {isExtracting ? <Loader2 className="animate-spin" /> : <Sparkles size={20} className="text-indigo-400" />}
                  {isExtracting ? 'Analyzing Content...' : 'Generate Questions'}
                </button>
              </div>

              <div className="w-full md:w-1/2 overflow-y-auto bg-slate-50/50 p-8">
                {/* CORE CONCEPTS SECTION */}
                {extractConceptTree.length > 0 && (
                  <div className="mb-10 space-y-4 animate-in fade-in slide-in-from-top-4 duration-500">
                    <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] flex items-center gap-2 text-left">
                      <BrainCircuit size={14} className="text-indigo-600"/> Core Concepts Breakdown
                    </h4>
                    <div className="bg-slate-900 rounded-3xl p-8 shadow-xl border border-slate-800 text-left">
                      <pre className="text-indigo-300 font-mono text-sm leading-relaxed overflow-x-auto whitespace-pre">
                        <Latex>{extractConceptTree.join('\n')}</Latex>
                      </pre>
                    </div>
                  </div>
                )}

                <div className="flex justify-between items-center mb-8">
                  <h3 className="text-sm font-bold uppercase tracking-widest text-slate-400 italic">Extracted Questions</h3>
                  <span className="bg-indigo-100 text-indigo-600 px-3 py-1 rounded-full text-[10px] font-black">{extractedQuestions.length} Questions</span>
                </div>
                <div className="space-y-6">
                  {allConceptsTested && (
                    <div className="bg-green-50 border-2 border-green-100 p-6 rounded-3xl flex items-center gap-4 animate-in fade-in zoom-in-95 duration-500 text-left">
                      <div className="w-10 h-10 rounded-full bg-green-500 flex items-center justify-center text-white shrink-0 shadow-lg shadow-green-200">
                        <Sparkles size={20} />
                      </div>
                      <div>
                        <p className="text-xs font-black uppercase text-green-700 tracking-wider">Full Coverage Reached</p>
                        <p className="text-[10px] text-green-600 font-bold leading-relaxed">Gemini has confirmed that all major concepts from your material are now thoroughly tested.</p>
                      </div>
                    </div>
                  )}

                  {extractedQuestions.length > 0 ? (
                    <>
                      {/* SINGLE QUESTION CARD VIEW */}
                      <div className="bg-white rounded-3xl p-8 border-2 border-slate-100 shadow-sm hover:border-indigo-100 transition-all space-y-6 text-left animate-in fade-in slide-in-from-right-4 duration-500 relative min-h-[400px] flex flex-col justify-between">
                        <div className="space-y-6">
                          <div className="flex justify-between items-center">
                            <span className="px-3 py-1 bg-indigo-600 text-white text-[10px] font-black uppercase rounded-lg tracking-wider">
                              {extractedQuestions[currentExtractIdx].type}
                            </span>
                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                              Question {currentExtractIdx + 1} of {extractedQuestions.length}
                            </span>
                          </div>

                          <div className="text-lg font-medium leading-relaxed prose prose-indigo">
                            <Latex>{extractedQuestions[currentExtractIdx].question}</Latex>
                          </div>

                          {extractedQuestions[currentExtractIdx].options && extractedQuestions[currentExtractIdx].options.length > 0 && (
                            <div className="grid grid-cols-1 gap-2 pl-4 border-l-2 border-indigo-50 py-2">
                              {extractedQuestions[currentExtractIdx].options.map((opt, oIdx) => (
                                <div key={oIdx} className="text-sm text-slate-600 font-medium"><Latex>{opt}</Latex></div>
                              ))}
                            </div>
                          )}
                        </div>

                        <div className="pt-4 border-t border-slate-50">
                          <button onClick={() => setShowExtractedSolutions(p => ({ ...p, [currentExtractIdx]: !p[currentExtractIdx] }))} className="flex items-center gap-2 text-sm font-bold text-indigo-600 bg-indigo-50 px-4 py-2 rounded-full hover:bg-indigo-100 transition-all">
                            {showExtractedSolutions[currentExtractIdx] ? <EyeOff size={14} /> : <Eye size={14} />} {showExtractedSolutions[currentExtractIdx] ? 'Hide Solution' : 'Show Solution'}
                          </button>
                          {showExtractedSolutions[currentExtractIdx] && (
                            <div className="mt-4 p-6 bg-slate-50 rounded-2xl border border-slate-100 animate-in zoom-in-95 duration-200">
                              <div className="text-xs font-black uppercase text-indigo-500 mb-3 flex items-center gap-2">
                                <span className="bg-indigo-100 px-2 py-0.5 rounded">Final Answer:</span>
                                <Latex>{extractedQuestions[currentExtractIdx].answer}</Latex>
                              </div>
                              <div className="prose prose-slate text-sm leading-relaxed"><Latex>{extractedQuestions[currentExtractIdx].solution}</Latex></div>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* NAVIGATION CONTROLS */}
                      <div className="flex gap-4">
                        <button 
                          onClick={() => setCurrentExtractIdx(prev => Math.max(0, prev - 1))}
                          disabled={currentExtractIdx === 0}
                          className={`flex-1 py-4 bg-white border-2 border-slate-100 rounded-2xl font-black text-xs uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${currentExtractIdx > 0 ? 'hover:border-indigo-600 hover:text-indigo-600 text-slate-600' : 'text-slate-300 opacity-50'}`}
                        >
                          <ChevronLeft size={16} /> Previous
                        </button>
                        <button 
                          onClick={() => setCurrentExtractIdx(prev => Math.min(extractedQuestions.length - 1, prev + 1))}
                          disabled={currentExtractIdx === extractedQuestions.length - 1}
                          className={`flex-1 py-4 bg-white border-2 border-slate-100 rounded-2xl font-black text-xs uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${currentExtractIdx < extractedQuestions.length - 1 ? 'hover:border-indigo-600 hover:text-indigo-600 text-slate-600' : 'text-slate-300 opacity-50'}`}
                        >
                          Next <ChevronRight size={16} />
                        </button>
                      </div>
                      
                      {/* LOAD MORE - ONLY AT THE END */}
                      {currentExtractIdx === extractedQuestions.length - 1 && (
                        <button 
                          onClick={handleMoreQuestions} 
                          disabled={isAddingMore}
                          className={`w-full py-4 mt-4 border-2 border-dashed border-indigo-200 rounded-3xl text-indigo-600 font-black text-xs uppercase tracking-widest hover:bg-indigo-50 hover:border-indigo-400 transition-all flex items-center justify-center gap-2 ${isAddingMore ? 'opacity-50 cursor-not-allowed' : ''}`}
                        >
                          {isAddingMore ? <Loader2 className="animate-spin" size={16} /> : <Plus size={16} />}
                          {isAddingMore ? 'Generating More...' : 'Load More Questions'}
                        </button>
                      )}
                    </>
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center text-center space-y-4 py-20 opacity-20">
                      <BrainCircuit size={48} className="text-slate-300" /><p className="font-bold uppercase tracking-[0.2em] text-xs text-slate-400">Awaiting Extraction</p>
                    </div>
                  )}
                </div>
              </div>
            </main>
          </div>
        )}
      </div>
    </div>
  );
}

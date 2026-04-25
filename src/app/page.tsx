'use client';

import { useState, useEffect, useRef } from 'react';
import { 
  Columns2, Smartphone, ChevronRight, Eye, EyeOff, Loader2, X, 
  BrainCircuit, Trash2, Upload, PlusCircle, ChevronDown, ChevronUp, 
  LogOut, History, Plus, FileText, ImageIcon, Sparkles, ChevronLeft, 
  GraduationCap, Settings, Share2, Copy, Bookmark, Verified, Terminal, Menu
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
  concept?: string;
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
  const [inputSidebarOpen, setInputSidebarOpen] = useState(true);

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
  const [showHelp, setShowHelp] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [breakerTab, setBreakerTab] = useState<'input' | 'output'>('input');
  
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
  const [showExtractionToast, setShowExtractionToast] = useState(false);
  const [selectedOptions, setSelectedOptions] = useState<Record<string, boolean>>({});
  const [crossedOutOptions, setCrossedOutOptions] = useState<Record<string, boolean>>({});

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
      const savedSubject = localStorage.getItem('qb_extract_subject');
      if (savedLevel) setExtractLevel(savedLevel);
      if (savedSubject) setExtractSubject(savedSubject);
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
      // If we're already in a textarea, let default behavior happen
      if (document.activeElement?.tagName === 'TEXTAREA' || document.activeElement?.tagName === 'INPUT') return;

      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        // Handle Images
        if (items[i].type.indexOf('image') !== -1) {
          const file = items[i].getAsFile();
          if (file) {
            e.preventDefault();
            let targetType = activeUploadType;
            // Heuristic: if we're in breaker mode, paste to question usually
            setActiveUploadType(targetType);
            setRawFile(file);
            const reader = new FileReader();
            reader.onload = () => { setImgSrc(reader.result?.toString() || ''); setStatus('cropping'); };
            reader.readAsDataURL(file);
            return;
          }
        }
        // Handle Text
        if (items[i].type === 'text/plain') {
          const text = e.clipboardData?.getData('text/plain');
          if (text) {
            e.preventDefault();
            setIsQuestionTextMode(true);
            setData(p => {
              const newData = { ...p, questionText: text };
              saveToDb(newData);
              return newData;
            });
            return;
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
    // 1. Fetch room data for Extractor sync
    const { data: room } = await supabase.from('rooms').select('*').eq('id', rId).single();
    if (room && room.latest_extraction) {
      setExtractedQuestions(room.latest_extraction.questions || []);
      setExtractConceptTree(room.latest_extraction.conceptTree || []);
      setExtractContent(room.latest_extraction.content || '');
      setExtractSubject(room.latest_extraction.subject || '');
      setExtractLevel(room.latest_extraction.level || 'Secondary School');
    }

    // 2. Fetch latest Breaker question
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
    if (item.status === 'extracted') {
      setActiveMode('extractor');
      setExtractContent(item.questionText || '');
      try {
        const parsed = JSON.parse(item.extractedText);
        setExtractedQuestions(parsed.questions || []);
        setExtractConceptTree(parsed.conceptTree || []);
      } catch (e) {
        setExtractedQuestions([]);
        setExtractConceptTree([]);
      }
    } else {
      setActiveMode('breaker');
      setData(item);
      setIsQuestionTextMode(!!item.isQuestionTextMode);
      setIsSolutionTextMode(!!item.isSolutionTextMode);
      setIsSolutionEnabled(!!(item.solutionImageUrl || item.solutionText));
      setStatus(item.status as SessionStatus || 'ready');
    }
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
      
      const contentType = resp.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        const text = await resp.text();
        console.error("Non-JSON response:", text);
        alert("The server took too long to respond (Timeout). Try a shorter text or try again in a moment.");
        return;
      }

      const result = await resp.json();
      if (result.questions) {
        setExtractedQuestions(result.questions);
        setExtractConceptTree(result.conceptTree || []);
        setAllConceptsTested(!!result.allConceptsTested);
        
        // Save to DB for history sync
        await saveToDb({
          questionText: extractContent,
          extractedText: JSON.stringify({ questions: result.questions, conceptTree: result.conceptTree }),
          status: 'extracted'
        }, 'extracted');
        
        fetchHistory(roomId!);
        setShowExtractionToast(true);
        setTimeout(() => setShowExtractionToast(false), 3000);
      } else if (result.error) {
        alert(`Extraction Error: ${result.error}${result.message ? ` - ${result.message}` : ''}`);
      }
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

      const contentType = resp.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        const text = await resp.text();
        console.error("Non-JSON response:", text);
        alert("The server took too long to respond (Timeout) during expansion. Try again in a moment.");
        return;
      }

      const result = await resp.json();
      if (result.questions) {
        setExtractedQuestions(prev => [...prev, ...result.questions]);
        if (result.conceptTree) setExtractConceptTree(result.conceptTree);
        setAllConceptsTested(!!result.allConceptsTested);
      } else if (result.error) {
        alert(`Expansion Error: ${result.error}${result.message ? ` - ${result.message}` : ''}`);
      }
    } catch (err: any) { alert("Network Error: " + err.message); }
    finally { setIsAddingMore(false); }
  };

  const saveToDb = async (updates: Partial<QuestionData>, newStatus?: string) => {
    if (!roomId) return null;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) await supabase.auth.signInAnonymously();
    const payload: any = {
      room_id: roomId,
      question_image_url: updates.hasOwnProperty('questionImageUrl') ? updates.questionImageUrl : data.questionImageUrl,
      question_text: updates.hasOwnProperty('questionText') ? updates.questionText : data.questionText,
      solution_image_url: updates.hasOwnProperty('solutionImageUrl') ? updates.solutionImageUrl : data.solutionImageUrl,
      solution_text: updates.hasOwnProperty('solutionText') ? updates.solutionText : data.solutionText,
      extracted_text: updates.hasOwnProperty('extractedText') ? updates.extractedText : data.extractedText,
      variations: updates.hasOwnProperty('variations') ? updates.variations : data.variations,
      is_question_text_mode: updates.hasOwnProperty('isQuestionTextMode') ? updates.isQuestionTextMode : isQuestionTextMode,
      is_solution_text_mode: updates.hasOwnProperty('isSolutionTextMode') ? updates.isSolutionTextMode : isSolutionTextMode,
      status: newStatus || updates.status || data.status || 'waiting'
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

  if (isInitializing) return <div className="min-h-screen bg-slate-50 flex items-center justify-center"><Loader2 className="animate-spin text-blue-900" /></div>;

  return (
    <div className="h-screen bg-[#faf9fa] text-[#1b1c1d] font-sans antialiased selection:bg-[#d9e2ff] selection:text-[#001946] flex flex-col md:flex-row overflow-hidden">
      {/* MOBILE HEADER */}
      <header className="md:hidden fixed top-0 w-full z-50 bg-white/80 backdrop-blur-xl flex justify-between items-center px-6 py-4 border-b border-slate-200/60">
        <div className="flex items-center gap-3">
          <button onClick={() => setShowHistory(true)} className="text-blue-900 active:scale-90 transition-transform">
            <History size={20} />
          </button>
          <h1 className="font-serif italic font-black text-blue-800 text-lg tracking-tight">Question Breaker</h1>
        </div>
        <button onClick={() => setShowSettings(true)} className="text-blue-900 active:scale-90 transition-transform">
          <Settings size={20} />
        </button>
      </header>

      {/* DESKTOP SIDEBAR */}
      <aside className={`hidden md:flex ${sidebarOpen ? 'w-64 px-6 opacity-100 border-r border-slate-200/60' : 'w-0 px-0 opacity-0 pointer-events-none border-none'} z-50 bg-white flex-col py-10 shrink-0 h-full transition-all duration-300 relative overflow-hidden`}>
        <div className="mb-12 px-2 whitespace-nowrap">
          <h1 className="font-serif text-2xl font-bold text-slate-900 tracking-tight">Question Breaker</h1>
        </div>

        <nav className="flex-1 space-y-2 whitespace-nowrap">
          <button 
            onClick={() => setActiveMode('breaker')}
            className={`w-full flex items-center justify-between px-4 py-3 rounded-lg transition-all duration-300 text-sm font-medium relative group ${activeMode === 'breaker' ? 'text-blue-900 bg-slate-50' : 'text-slate-500 hover:bg-slate-50'}`}
          >
            <div className="flex items-center gap-4">
              <BrainCircuit size={18} className={activeMode === 'breaker' ? 'text-blue-900' : 'text-slate-400'} />
              <span>Breaker</span>
            </div>
            {activeMode === 'breaker' && <div className="absolute right-0 h-4 w-[2.5px] bg-blue-900 rounded-full"></div>}
          </button>
          <button 
            onClick={() => setActiveMode('extractor')}
            className={`w-full flex items-center justify-between px-4 py-3 rounded-lg transition-all duration-300 text-sm font-medium relative group ${activeMode === 'extractor' ? 'text-blue-900 bg-slate-50' : 'text-slate-500 hover:bg-slate-50'}`}
          >
            <div className="flex items-center gap-4">
              <Sparkles size={18} className={activeMode === 'extractor' ? 'text-blue-900' : 'text-slate-400'} />
              <span>Extractor</span>
            </div>
            {activeMode === 'extractor' && <div className="absolute right-0 h-4 w-[2.5px] bg-blue-900 rounded-full"></div>}
          </button>
        </nav>

        <div className="mt-auto pt-8 border-t border-slate-200/60 space-y-2 whitespace-nowrap">
          <button onClick={() => setShowHistory(true)} className="w-full flex items-center gap-4 px-4 py-3 text-slate-500 hover:bg-slate-50 rounded-lg transition-all text-sm font-medium">
            <History size={18} className="text-slate-400" />
            <span>History</span>
          </button>
          <button onClick={() => setShowHelp(true)} className="w-full flex items-center gap-4 px-4 py-3 text-slate-500 hover:bg-slate-50 rounded-lg transition-all text-sm font-medium">
            <X size={18} className="text-slate-400" />
            <span>Help</span>
          </button>
        </div>
      </aside>

      {/* HELP MODAL */}
      {showHelp && (
        <div className="fixed inset-0 z-[150] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="bg-white rounded-3xl shadow-2xl max-w-2xl w-full overflow-hidden animate-in zoom-in-95 duration-300">
            <div className="bg-blue-900 p-8 text-white flex justify-between items-center">
              <div className="flex items-center gap-3">
                <BrainCircuit size={24} />
                <h2 className="text-xl font-serif font-bold tracking-tight">How to use Question Breaker</h2>
              </div>
              <button onClick={() => setShowHelp(false)} className="p-2 hover:bg-white/10 rounded-full transition-colors">
                <X size={20} />
              </button>
            </div>
            
            <div className="p-8 md:p-10 space-y-8 overflow-y-auto max-h-[70vh]">
              <section className="space-y-3">
                <h3 className="font-bold text-blue-900 uppercase tracking-widest text-xs flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-900"></span> Mode 1: Breaker
                </h3>
                <p className="text-slate-600 text-sm leading-relaxed">
                  Best for deep-diving into a single tough question. Upload an image or paste the text, optionally add your own solution, and get 4 unique AI-generated variations (Conceptual Flip, Edge Case, etc.) to test your understanding.
                </p>
              </section>

              <section className="space-y-3">
                <h3 className="font-bold text-blue-900 uppercase tracking-widest text-xs flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-900"></span> Mode 2: Extractor
                </h3>
                <p className="text-slate-600 text-sm leading-relaxed">
                  Upload lecture notes or transcripts to generate a set of practice questions automatically. It identifies core concepts and creates targeted MCQs, MRQs, and Short Response questions based on your material.
                </p>
              </section>

              <section className="space-y-3">
                <h3 className="font-bold text-blue-900 uppercase tracking-widest text-xs flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-900"></span> Pro Tips
                </h3>
                <ul className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <li className="flex items-start gap-3 bg-slate-50 p-4 rounded-2xl">
                    <Smartphone size={18} className="text-blue-900 shrink-0" />
                    <span className="text-xs text-slate-600"><strong>Realtime Sync:</strong> Pair your phone and laptop using the 6-digit code to snap photos on mobile and see them instantly on your desktop.</span>
                  </li>
                  <li className="flex items-start gap-3 bg-slate-50 p-4 rounded-2xl">
                    <Copy size={18} className="text-blue-900 shrink-0" />
                    <span className="text-xs text-slate-600"><strong>Global Paste:</strong> You can paste images or text directly anywhere on the page to quickly start an analysis.</span>
                  </li>
                </ul>
              </section>
            </div>
            
            <div className="p-8 border-t border-slate-100 flex justify-end">
              <button 
                onClick={() => setShowHelp(false)}
                className="px-8 py-3 bg-blue-900 text-white rounded-full font-bold text-sm shadow-lg shadow-blue-900/20 hover:scale-[1.02] active:scale-95 transition-all"
              >
                Got it, thanks!
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 flex flex-col h-full overflow-hidden relative">
        {/* Sidebar Toggle Arrow (Floating) */}
        <button 
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="hidden md:flex fixed top-1/2 -translate-y-1/2 z-[60] w-6 h-12 bg-blue-900 border border-blue-800 border-l-0 rounded-r-xl items-center justify-center text-white hover:bg-blue-800 shadow-sm transition-all active:scale-95 group"
          style={{ left: sidebarOpen ? '256px' : '0px', transition: 'left 300ms cubic-bezier(0.4, 0, 0.2, 1)' }}
        >
          {sidebarOpen ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
        </button>

        {/* DESKTOP HEADER */}
        <header className="hidden md:flex bg-blue-900 justify-between items-center px-10 h-20 shrink-0 shadow-md">
          <div className="flex items-center gap-6">
            <span className="font-serif font-bold text-white tracking-tight text-xl">
              {activeMode === 'breaker' ? 'Analysis View' : 'Workspace'}
            </span>
          </div>
          <div className="flex items-center gap-6">
            <button onClick={() => setShowHistory(true)} className="p-2 text-blue-100 hover:text-white transition-colors"><History size={20}/></button>
            <button onClick={() => setShowSettings(true)} className="p-2 text-blue-100 hover:text-white transition-colors"><Settings size={20}/></button>
          </div>
        </header>

        {/* SETTINGS MODAL */}
        {showSettings && (
          <div className="fixed inset-0 z-[150] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-6">
            <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full overflow-hidden animate-in zoom-in-95 duration-300">
              <div className="bg-blue-900 p-6 text-white flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <Settings size={20} />
                  <h2 className="font-bold tracking-tight">Session Settings</h2>
                </div>
                <button onClick={() => setShowSettings(false)} className="p-2 hover:bg-white/10 rounded-full transition-colors">
                  <X size={18} />
                </button>
              </div>
              
              <div className="p-8 space-y-8">
                <div className="space-y-3 text-center">
                  <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Current Pairing Code</span>
                  <div className="bg-slate-50 border-2 border-dashed border-blue-100 p-6 rounded-2xl">
                    <span className="text-4xl font-mono font-black text-blue-900 tracking-widest">{pairingCode || '------'}</span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed px-4">
                    Share this code with your other devices to sync questions and analysis in realtime.
                  </p>
                </div>

                <div className="pt-4 space-y-3">
                  <button 
                    onClick={resetSession}
                    className="w-full py-4 bg-red-50 text-red-600 rounded-xl font-bold text-sm flex items-center justify-center gap-2 hover:bg-red-100 transition-all"
                  >
                    <LogOut size={18} />
                    <span>Exit Current Session</span>
                  </button>
                  <p className="text-[10px] text-center text-slate-400 font-medium">
                    This will clear your local room data and start a fresh session.
                  </p>
                </div>
              </div>
              
              <div className="p-6 border-t border-slate-50 flex justify-center">
                <button onClick={() => setShowSettings(false)} className="text-xs font-bold text-slate-400 hover:text-blue-900 transition-colors uppercase tracking-widest">
                  Close Settings
                </button>
              </div>
            </div>
          </div>
        )}

        {/* CROP OVERLAY */}
        {status === 'cropping' && imgSrc && (
          <div className="fixed inset-0 z-[100] bg-slate-900/95 backdrop-blur-sm flex flex-col">
            <div className="p-4 flex justify-between items-center text-white bg-slate-950 border-b border-white/5">
              <button onClick={() => setStatus('waiting')} className="p-2 hover:bg-white/10 rounded-full"><X /></button>
              <span className="font-bold text-xs uppercase tracking-widest">Adjust Crop Area</span>
              <button onClick={handleConfirmCrop} className="bg-blue-900 px-8 py-2 rounded-full font-black text-xs uppercase shadow-xl hover:bg-blue-900 transition-all">Confirm Crop</button>
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
              <div className="flex-1 overflow-y-auto p-6 pb-24 space-y-3">
                <button onClick={() => { startNewQuestion(); setShowHistory(false); }} className="w-full p-4 border-2 border-dashed border-blue-100 rounded-xl text-blue-900 font-bold text-xs uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-blue-50 transition-all mb-4">
                  <Plus size={16}/> New Question
                </button>
                {history.map((item, idx) => (
                  <button key={idx} onClick={() => loadFromHistory(item)} className={`w-full text-left p-4 rounded-xl border transition-all ${data.id === item.id ? 'border-blue-900 bg-blue-50/30' : 'border-slate-100 bg-slate-50/50 hover:border-slate-200'}`}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold uppercase text-slate-400">{item.created_at ? new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Recent'}</span>
                        {item.status === 'ready' && <div className="w-1 h-1 rounded-full bg-green-500"></div>}
                      </div>
                      {item.status === 'extracted' && (
                        <span className="text-[8px] font-black bg-blue-900 text-white px-1.5 py-0.5 rounded uppercase tracking-tighter">Extraction</span>
                      )}
                    </div>
                    <p className="text-xs font-medium text-slate-600 line-clamp-2">{item.questionText || (item.questionImageUrl ? '[Question Image]' : 'Empty Question')}</p>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        <main className="flex-1 flex flex-col overflow-y-auto scrollbar-hide md:overflow-hidden pt-20 pb-28 md:pt-0 md:pb-0">
          {activeMode === 'breaker' ? (
            !roomId ? (
              /* JOIN SCREEN */
              <div className="flex-1 flex flex-col items-center justify-center p-6 h-full bg-slate-50">
                <div className="max-w-sm w-full space-y-8 bg-white p-10 rounded-2xl shadow-sm border border-slate-200/50 text-center">
                  <h1 className="text-3xl font-serif font-black text-slate-900 tracking-tighter">Question Breaker</h1>
                  <button onClick={createRoom} className="w-full flex items-center justify-center gap-3 p-4 bg-blue-900 hover:bg-blue-900 text-white rounded-xl font-bold transition-all shadow-lg shadow-blue-200">
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
              <div className="flex flex-col md:flex-row h-full overflow-hidden relative">
                {/* Mobile Tab Switcher */}
                <div className="md:hidden flex bg-white border-b border-slate-200/60 p-1 m-4 rounded-xl shadow-sm shrink-0 sticky top-0 z-20">
                  <button 
                    onClick={() => setBreakerTab('input')}
                    className={`flex-1 py-2 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all ${breakerTab === 'input' ? 'bg-blue-900 text-white shadow-md' : 'text-slate-400'}`}
                  >
                    Question
                  </button>
                  <button 
                    onClick={() => setBreakerTab('output')}
                    className={`flex-1 py-2 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all ${breakerTab === 'output' ? 'bg-blue-900 text-white shadow-md' : 'text-slate-400'}`}
                  >
                    Variations
                  </button>
                </div>

                {/* Left: Output Column (Variations) */}
                <section className={`flex-1 p-6 md:p-8 lg:p-12 bg-slate-50/50 border-b md:border-b-0 md:border-r border-slate-200/60 overflow-y-auto scrollbar-hide transition-all duration-300 ${breakerTab === 'output' ? 'flex' : 'hidden md:flex'}`}>
                  <div className="space-y-8 w-full">
                    <div className="space-y-6">
                      <div className="flex items-center justify-between border-b border-slate-200/30 pb-4">
                        <h3 className="text-xl font-headline font-bold tracking-tight text-slate-900">Active Variations</h3>
                        {status === 'ready' && <span className="bg-blue-900 text-white px-3 py-1 rounded-full text-xs font-black uppercase tracking-wider">{data.variations.length} Generated</span>}
                      </div>

                      {status === 'ready' ? (
                        <div className="space-y-4">
                          {data.variations.map((v, i) => {
                            const labelMatch = v.text.match(/^\[(.*?)\]/);
                            const label = labelMatch ? labelMatch[1] : `Analysis Path ${i + 1}`;
                            const cleanText = labelMatch ? v.text.replace(/^\[.*?\]/, '').trim() : v.text;
                            
                            return (
                              <div key={i} className={`bg-white rounded-2xl shadow-sm border transition-all ${expandedVariations[i] ? 'border-blue-900/20 ring-1 ring-blue-900/10' : 'border-slate-200/60'}`}>
                                <div className="p-5 flex justify-between items-start cursor-pointer hover:bg-slate-50/50 transition-colors rounded-t-2xl" onClick={() => setExpandedVariations(p => ({ ...p, [i]: !p[i] }))}>
                                  <div className="space-y-1">
                                    <span className="text-xs font-black uppercase tracking-widest text-blue-900">{v.category}</span>
                                    <h3 className="font-headline font-bold text-lg text-slate-900 line-clamp-1">{label}</h3>
                                  </div>
                                  <button className="text-slate-400">
                                    {expandedVariations[i] ? <ChevronUp size={20}/> : <ChevronDown size={20}/>}
                                  </button>
                                </div>
                                
                                <div className={`px-5 pb-5 space-y-4 transition-all ${expandedVariations[i] ? 'block' : 'hidden'}`}>
                                  <div className="font-body text-sm leading-relaxed text-slate-700 prose prose-blue max-w-none whitespace-pre-wrap">
                                    <Latex>{cleanText}</Latex>
                                  </div>
                                
                                <div className="pt-4 border-t border-slate-50 space-y-3">
                                  {!showSolutions[i] ? (
                                    <button 
                                      onClick={() => setShowSolutions(p => ({ ...p, [i]: true }))}
                                      className="flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-900 rounded-lg text-xs font-bold uppercase tracking-widest hover:bg-blue-100 transition-all"
                                    >
                                      <Eye size={14}/> Show Solution
                                    </button>
                                  ) : (
                                    <>
                                      <div className="flex items-center justify-between">
                                        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Step-by-Step Solution</span>
                                        <button onClick={() => setShowSolutions(p => ({ ...p, [i]: false }))} className="text-slate-400 hover:text-slate-600"><EyeOff size={14}/></button>
                                      </div>
                                      <div className="p-4 bg-slate-50 rounded-xl text-xs italic font-serif leading-relaxed text-slate-600 border border-slate-100 whitespace-pre-wrap">
                                        <Latex>{v.solution}</Latex>
                                      </div>
                                    </>
                                  )}
                                  
                                  <div className="flex gap-4 pt-2">
                                    <button className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-blue-900 active:scale-95 transition-all">
                                      Copy Question <ChevronRight size={12}/>
                                    </button>
                                    <button className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                                      Share <Share2 size={12}/>
                                    </button>
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
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

                {/* Input Sidebar Toggle Arrow (Floating) */}
                {roomId && (
                  <button 
                    onClick={() => setInputSidebarOpen(!inputSidebarOpen)}
                    className="hidden md:flex absolute top-1/2 -translate-y-1/2 z-[60] w-6 h-12 bg-blue-900 border border-blue-800 border-r-0 rounded-l-xl items-center justify-center text-white hover:bg-blue-800 shadow-sm transition-all active:scale-95 group"
                    style={{ right: inputSidebarOpen ? '50%' : '0px', transition: 'right 300ms cubic-bezier(0.4, 0, 0.2, 1)' }}
                  >
                    {inputSidebarOpen ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
                  </button>
                )}

                {/* Right: Input Column (Source Materials) */}
                <section className={`${breakerTab === 'input' ? 'flex' : 'hidden md:flex'} ${inputSidebarOpen ? 'md:w-1/2 px-6 md:px-10 lg:px-14 border-l border-slate-200/60 opacity-100' : 'w-0 px-0 opacity-0 pointer-events-none border-none'} bg-white flex-col py-10 md:py-12 shrink-0 h-full transition-all duration-300 relative overflow-y-auto space-y-8 md:space-y-12`}>
                  <header className="md:block">
                    <span className="md:hidden label-style text-[10px] font-bold uppercase tracking-widest text-blue-900">Current Module</span>
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
                             <button onClick={() => { setIsQuestionTextMode(false); setData(p => ({ ...p, variations: [], questionText: '' })); saveToDb({ variations: [], questionText: '' }); }} className="text-[10px] font-bold uppercase text-blue-900 hover:underline">Switch to Image</button>
                           </div>
                           <textarea placeholder="Paste or type question here..." value={data.questionText} onChange={(e) => { const val = e.target.value; setData(p => ({ ...p, questionText: val, variations: val ? p.variations : [] })); }} onBlur={(e) => saveToDb({ questionText: e.target.value, variations: e.target.value ? data.variations : [] })} className="question-input w-full min-h-[180px] bg-slate-50/50 rounded-xl p-6 text-base border border-slate-200 focus:ring-2 focus:ring-blue-500/10 outline-none transition-all resize-none font-body leading-relaxed" />
                        </div>
                      ) : (
                        data.questionImageUrl ? (
                          <div className="space-y-2">
                            <div className="flex justify-between items-center px-1">
                              <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">The Question</label>
                              <button onClick={() => { setIsQuestionTextMode(true); setData(p => ({ ...p, variations: [], questionImageUrl: null })); saveToDb({ variations: [], questionImageUrl: null }); }} className="text-[10px] font-bold uppercase text-blue-900 hover:underline">Switch to Text</button>
                            </div>
                            <div className="relative group">
                              <img src={data.questionImageUrl} alt="Question" className="w-full rounded-xl border border-slate-200 shadow-sm cursor-pointer hover:opacity-95 transition-all" onClick={() => { setActiveUploadType('question'); fileInputRef.current?.click(); }} />
                              <button onClick={(e) => { e.stopPropagation(); const updates = { questionImageUrl: null, variations: [], status: 'waiting' }; setData(p => ({ ...p, ...updates })); saveToDb(updates); }} className="absolute top-4 right-4 p-2 bg-white/90 backdrop-blur rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition-opacity md:opacity-100"><Trash2 size={16} className="text-red-500"/></button>
                            </div>
                          </div>
                        ) : (
                          /* CAPTURE ZONE */
                          <div className="space-y-2">
                            <div className="flex justify-between items-center px-1">
                              <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">The Question</label>
                              <button onClick={() => { setIsQuestionTextMode(true); setData(p => ({ ...p, variations: [] })); saveToDb({ variations: [] }); }} className="text-[10px] font-bold uppercase text-blue-900 hover:underline">Switch to Text</button>
                            </div>
                            <div className="relative group min-h-[240px] rounded-xl overflow-hidden bg-slate-50 flex flex-col items-center justify-center space-y-4 border-2 border-dashed border-slate-200 transition-all hover:border-blue-400">
                              <div className="z-10 flex flex-col items-center gap-4">
                                <button onClick={() => { setActiveUploadType('question'); fileInputRef.current?.click(); }} className="w-16 h-16 rounded-full bg-blue-900 flex items-center justify-center text-white shadow-xl ring-8 ring-blue-100/50 active:scale-95 transition-transform">
                                  <ImageIcon size={28} />
                                </button>
                                <div className="text-center px-4">
                                  <p className="font-headline font-bold text-lg text-slate-900">Capture Question</p>
                                  <p className="text-xs text-slate-400 font-medium uppercase tracking-wider">Scan or upload document</p>
                                </div>
                              </div>
                            </div>
                          </div>
                        )
                      )}
                    </div>

                    {/* Solution Toggle Area */}
                    <div className="bg-slate-50 rounded-2xl p-6 space-y-4 border border-slate-200/60">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Verified size={18} className="text-blue-900" />
                          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-600">Solution Reference</span>
                        </div>
                        <div className="flex items-center gap-4">
                          {isSolutionEnabled && (
                            <button onClick={() => setIsSolutionTextMode(!isSolutionTextMode)} className="text-[10px] font-bold uppercase text-blue-900 hover:underline">
                              {isSolutionTextMode ? 'Switch to Image' : 'Switch to Text'}
                            </button>
                          )}
                          <label className="relative inline-flex items-center cursor-pointer">
                            <input type="checkbox" checked={isSolutionEnabled} onChange={(e) => setIsSolutionEnabled(e.target.checked)} className="sr-only peer" />
                            <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-900"></div>
                          </label>
                        </div>
                      </div>
                      {isSolutionEnabled && (
                        <div className="pt-2 animate-in fade-in slide-in-from-top-2 duration-300">
                          {isSolutionTextMode ? (
                            <textarea placeholder="Paste reference solution steps..." value={data.solutionText} onChange={(e) => setData(p => ({ ...p, solutionText: e.target.value }))} onBlur={(e) => saveToDb({ solutionText: e.target.value })} className="solution-input w-full min-h-[140px] bg-white rounded-xl p-4 text-sm border border-slate-200 focus:ring-2 focus:ring-blue-500/10 outline-none transition-all resize-none italic text-slate-600 font-serif leading-relaxed" />
                          ) : (
                            data.solutionImageUrl ? (
                              <div className="relative">
                                <img src={data.solutionImageUrl} alt="Solution" className="w-full rounded-xl border border-slate-200 shadow-sm" onClick={() => { setActiveUploadType('solution'); fileInputRef.current?.click(); }} />
                                <button onClick={() => { const updates = { solutionImageUrl: null, variations: [], status: 'waiting' }; setData(p => ({ ...p, ...updates })); saveToDb(updates); }} className="absolute top-2 right-2 p-1.5 bg-white/90 backdrop-blur rounded-full text-red-500 shadow-sm"><Trash2 size={14}/></button>
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
                      <button onClick={handleProcessWithAI} className="w-full py-5 bg-gradient-to-r from-blue-900 to-blue-800 text-white rounded-full font-bold tracking-tight shadow-xl shadow-blue-900/20 flex items-center justify-center gap-3 hover:scale-[1.01] active:scale-95 transition-all group">
                        <Sparkles size={20} className="group-hover:rotate-12 transition-transform" />
                        <span>Submit to Gemini</span>
                      </button>
                    )}
                    {status === 'ready' && (
                      <button onClick={startNewQuestion} className="w-full py-4 border border-blue-200 rounded-full text-blue-900 font-bold flex items-center justify-center gap-2 hover:bg-blue-50 transition-all bg-white shadow-sm active:scale-95">
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
              </div>
            )
          ) : (
            /* EXTRACTOR VIEW (Refactored to match snippet) */
            <div className="flex-1 overflow-y-auto bg-white scrollbar-hide">
              <div className="max-w-[1100px] mx-auto p-4 md:p-6 space-y-6">
                {/* Top Section: Source Material Entry */}
                <section className="space-y-4">
                  <header className="space-y-1">
                    <span className="text-sm font-bold uppercase tracking-widest text-blue-900">Workspace</span>
                    <h2 className="font-headline text-3xl font-bold text-slate-900">Source Material</h2>
                  </header>
                  
                  <div className="space-y-4">
                    <div className="relative group">
                      <textarea 
                        className="w-full min-h-[200px] p-4 bg-slate-50/50 border border-slate-200 focus:ring-2 focus:ring-blue-500/10 rounded-xl font-body text-base md:text-lg leading-relaxed text-slate-900 transition-all resize-none shadow-sm outline-none" 
                        placeholder="Paste your lecture notes, transcript, or study material here..."
                        value={extractContent}
                        onChange={(e) => setExtractContent(e.target.value)}
                      />
                      <div className="absolute bottom-3 right-4 flex items-center gap-2 text-slate-400 font-bold text-sm uppercase tracking-wider">
                        <FileText size={14} />
                        <span>{extractContent.split(/\s+/).filter(x => x).length} words</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="space-y-1 text-left">
                        <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-1">Subject / Module</label>
                        <input 
                          className="w-full bg-slate-50 border border-slate-100 rounded-lg px-3 py-2 font-body text-xs font-bold focus:ring-2 focus:ring-blue-500/10 outline-none transition-all" 
                          placeholder="e.g. Cognitive Psychology" 
                          type="text"
                          value={extractSubject}
                          onChange={(e) => { setExtractSubject(e.target.value); localStorage.setItem('qb_extract_subject', e.target.value); }}
                        />
                      </div>
                      <div className="space-y-1 text-left">
                        <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-1">Target Level</label>
                        <select 
                          className="w-full bg-slate-50 border border-slate-100 rounded-lg px-3 py-2 font-body text-xs font-bold focus:ring-2 focus:ring-blue-500/10 outline-none transition-all appearance-none cursor-pointer"
                          value={extractLevel}
                          onChange={(e) => { setExtractLevel(e.target.value); localStorage.setItem('qb_extract_level', e.target.value); }}
                        >
                          <option>Primary School</option>
                          <option>Secondary School</option>
                          <option>Junior College</option>
                          <option>University</option>
                        </select>
                      </div>
                    </div>

                    <button 
                      onClick={handleExtract}
                      disabled={isExtracting || !extractContent.trim()}
                      className={`w-full py-3 bg-gradient-to-r from-blue-900 to-blue-800 text-white rounded-lg font-bold tracking-tight flex items-center justify-center gap-2 transition-all shadow-lg shadow-blue-900/20 group ${isExtracting ? 'opacity-50 cursor-not-allowed' : 'hover:scale-[1.01] active:scale-[0.98]'}`}
                    >
                      {isExtracting ? <Loader2 className="animate-spin" size={16} /> : <Sparkles size={16} className="group-hover:rotate-12 transition-transform" />}
                      {isExtracting ? 'Analyzing Text...' : 'Generate Questions'}
                    </button>
                  </div>
                </section>

                {/* Divider */}
                <div className="h-px bg-slate-100"></div>

                {/* Bottom Section: Extracted Questions Viewer */}
                {(extractedQuestions.length > 0 || extractConceptTree.length > 0) && (
                <section className="space-y-4 pb-10">
                {/* Terminal Style Concept Breakdown */}
                {extractConceptTree.length > 0 && (
                  <div className="bg-[#12141d] rounded-xl p-4 overflow-hidden relative group shadow-xl animate-in fade-in slide-in-from-top-4 duration-500">
                    <div className="absolute top-0 right-0 w-24 h-24 bg-blue-500/10 blur-3xl rounded-full"></div>
                    <div className="flex items-center gap-3 mb-3 border-b border-white/10 pb-2">
                      <div className="flex gap-1.5">
                        <div className="w-2 h-2 rounded-full bg-red-500/40"></div>
                        <div className="w-2 h-2 rounded-full bg-yellow-500/40"></div>
                        <div className="w-2 h-2 rounded-full bg-green-500/40"></div>
                      </div>
                      <span className="text-[10px] font-mono text-slate-500 uppercase tracking-widest">Core_Concepts_Breakdown.sh</span>
                    </div>
                    <div className="font-mono text-xs space-y-1.5 text-left leading-relaxed">
                      {extractConceptTree.map((concept, idx) => (
                        <div key={idx} className="flex gap-3">
                          <span className="text-blue-400">$</span>
                          <div className="text-slate-300">
                            <Latex>{concept}</Latex>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Single Question Viewer Card */}
                {extractedQuestions.length > 0 && (
                  <div className="space-y-3">
                    <div className="bg-white rounded-xl p-5 md:p-6 shadow-sm border border-slate-200/60 min-h-[350px] flex flex-col justify-between text-left transition-all animate-in fade-in slide-in-from-right-4 duration-500">
                      <div className="space-y-4">
                        <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-2 border-b border-slate-100 pb-3">
                          <div className="flex items-center gap-2">
                            <span className="px-2 py-0.5 bg-blue-900 text-white text-[10px] font-black uppercase tracking-wider rounded">
                              {extractedQuestions[currentExtractIdx].type}
                            </span>
                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-l border-slate-200 pl-2">
                              Question {currentExtractIdx + 1} of {extractedQuestions.length}
                            </span>
                          </div>
                          {extractedQuestions[currentExtractIdx].concept && (
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Concept:</span>
                              <span className="text-xs font-black uppercase tracking-widest text-blue-900 bg-blue-50 px-2 py-0.5 rounded">
                                <Latex>{extractedQuestions[currentExtractIdx].concept}</Latex>
                              </span>
                            </div>
                          )}
                        </div>

                        <h3 className="font-headline text-base md:text-lg font-medium text-slate-900 leading-snug">
                          <Latex>{extractedQuestions[currentExtractIdx].question}</Latex>
                        </h3>

                        {extractedQuestions[currentExtractIdx].options && extractedQuestions[currentExtractIdx].options.length > 0 && (
                          <div className="grid grid-cols-1 gap-2 py-1">
                            {extractedQuestions[currentExtractIdx].options.map((opt, oIdx) => {
                              const isSelected = !!selectedOptions[`${currentExtractIdx}-${oIdx}`];
                              const isCrossedOut = !!crossedOutOptions[`${currentExtractIdx}-${oIdx}`];
                              return (
                                <div 
                                  key={oIdx} 
                                  onClick={() => !isCrossedOut && setSelectedOptions(p => ({ ...p, [`${currentExtractIdx}-${oIdx}`]: !p[`${currentExtractIdx}-${oIdx}`] }))}
                                  className={`p-2.5 rounded-lg text-sm flex items-center justify-between border transition-all cursor-pointer group ${
                                    isSelected 
                                    ? 'bg-blue-900 border-blue-900 shadow-md' 
                                    : isCrossedOut 
                                      ? 'bg-slate-100 border-slate-200 opacity-60' 
                                      : 'bg-slate-50/50 border-slate-100 hover:border-blue-900/20 hover:bg-blue-50/30'
                                  }`}
                                >
                                  <div className="flex items-center gap-3">
                                    <span className={`w-5 h-5 flex items-center justify-center rounded-full border text-[10px] font-black transition-all ${
                                      isSelected 
                                      ? 'bg-white border-white text-blue-900' 
                                      : 'bg-white border-slate-200 text-slate-400 group-hover:text-blue-900 group-hover:border-blue-900'
                                    }`}>
                                      {String.fromCharCode(65 + oIdx)}
                                    </span>
                                    <span className={`font-body font-medium transition-all ${isSelected ? 'text-white' : isCrossedOut ? 'text-slate-400 line-through' : 'text-slate-700'}`}>
                                      <Latex>{opt}</Latex>
                                    </span>
                                  </div>
                                  
                                  <button 
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const key = `${currentExtractIdx}-${oIdx}`;
                                      setCrossedOutOptions(p => ({ ...p, [key]: !p[key] }));
                                      if (!crossedOutOptions[key]) setSelectedOptions(p => ({ ...p, [key]: false }));
                                    }}
                                    className={`p-1.5 rounded-full transition-colors ${isSelected ? 'text-white/40 hover:text-white' : 'text-slate-300 hover:text-blue-900 hover:bg-blue-50'}`}
                                  >
                                    {isCrossedOut ? <Eye size={14} /> : <EyeOff size={14} />}
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      <div className="pt-3 border-t border-slate-100 space-y-2">
                        <button 
                          onClick={() => setShowExtractedSolutions(p => ({ ...p, [currentExtractIdx]: !p[currentExtractIdx] }))}
                          className="flex items-center gap-2 text-blue-900 font-bold text-xs group"
                        >
                          <ChevronDown 
                            size={14} 
                            className={`transition-transform duration-300 ${showExtractedSolutions[currentExtractIdx] ? 'rotate-180' : ''}`} 
                          />
                          {showExtractedSolutions[currentExtractIdx] ? 'Hide Solution' : 'Show Solution & Explanation'}
                        </button>
                        {showExtractedSolutions[currentExtractIdx] && (
                          <div className="mt-2 p-4 bg-blue-50/30 rounded-lg text-sm leading-relaxed text-slate-700 font-body border border-blue-100/50 animate-in zoom-in-95 duration-200">
                            <p className="font-black text-blue-900 text-xs uppercase tracking-widest mb-2 flex items-center gap-2">
                              <span className="w-1.5 h-1.5 rounded-full bg-blue-900"></span> Detailed Analysis
                            </p>
                            <div className="space-y-3">
                              <p className="font-bold text-slate-900 text-base border-b border-blue-100/50 pb-2 mb-2">Correct Answer: <Latex>{extractedQuestions[currentExtractIdx].answer}</Latex></p>
                              <div className="prose prose-blue max-w-none text-sm whitespace-pre-wrap text-slate-600"><Latex>{extractedQuestions[currentExtractIdx].solution}</Latex></div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Navigation Controls */}
                    <div className="flex gap-2">
                      <button 
                        onClick={() => setCurrentExtractIdx(prev => Math.max(0, prev - 1))}
                        disabled={currentExtractIdx === 0}
                        className="flex-1 py-2 bg-white border border-slate-200 rounded-lg font-bold text-[10px] uppercase tracking-widest text-slate-400 hover:text-blue-900 hover:border-blue-600 transition-all flex items-center justify-center gap-2 disabled:opacity-30"
                      >
                        <ChevronLeft size={12} /> Previous
                      </button>
                      <button 
                        onClick={() => setCurrentExtractIdx(prev => Math.min(extractedQuestions.length - 1, prev + 1))}
                        disabled={currentExtractIdx === extractedQuestions.length - 1}
                        className="flex-1 py-2 bg-white border border-slate-200 rounded-lg font-bold text-[10px] uppercase tracking-widest text-slate-400 hover:text-blue-900 hover:border-blue-600 transition-all flex items-center justify-center gap-2 disabled:opacity-30"
                      >
                        Next <ChevronRight size={12} />
                      </button>
                    </div>

                    {/* Load More Button */}
                    <button 
                      onClick={handleMoreQuestions}
                      disabled={isAddingMore}
                      className="w-full py-2 border-2 border-dashed border-blue-200 bg-blue-50/20 rounded-lg text-blue-900 font-bold text-[10px] uppercase tracking-widest hover:bg-blue-50 hover:border-blue-400 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      {isAddingMore ? <Loader2 className="animate-spin" size={12} /> : <Plus size={12} />}
                      {isAddingMore ? 'Extending Analysis...' : 'Load More Questions'}
                    </button>
                  </div>
                )}
                    {/* Footer Info */}
                    <div className="flex justify-between items-center px-4 py-8 text-slate-400 font-bold text-[10px] uppercase tracking-wider">
                      <div className="flex items-center gap-2">
                        <Verified size={14} className="text-blue-500" />
                        <span>Generated by Pedagogy AI v4.2</span>
                      </div>
                      <div className="flex gap-6">
                        <button className="hover:text-blue-900 transition-colors">Export PDF</button>
                        <button className="hover:text-blue-900 transition-colors">Sync to Notion</button>
                      </div>
                    </div>
                  </section>
                )}
              </div>
            </div>
          )}
        </main>

        {/* MOBILE BOTTOM NAV */}
        <nav className="md:hidden fixed bottom-0 left-0 w-full flex justify-around items-center px-4 pb-safe pt-2 bg-white/90 backdrop-blur-md border-t border-slate-200/20 z-[160]">
          <button onClick={() => { setActiveMode('breaker'); setShowHistory(false); setShowSettings(false); }} className={`flex flex-col items-center justify-center px-6 py-2 transition-all active:scale-90 ${activeMode === 'breaker' && !showHistory && !showSettings ? 'text-blue-900 bg-blue-50/50 rounded-xl' : 'text-slate-400'}`}>
            <BrainCircuit size={22} />
            <span className="text-[10px] font-bold uppercase tracking-widest mt-1">Breaker</span>
          </button>
          <button onClick={() => { setActiveMode('extractor'); setShowHistory(false); setShowSettings(false); }} className={`flex flex-col items-center justify-center px-6 py-2 transition-all active:scale-90 ${activeMode === 'extractor' && !showHistory && !showSettings ? 'text-blue-900 bg-blue-50/50 rounded-xl' : 'text-slate-400'}`}>
            <Sparkles size={22} />
            <span className="text-[10px] font-bold uppercase tracking-widest mt-1">Extractor</span>
          </button>
          <button onClick={() => { setShowHistory(true); setShowSettings(false); }} className={`flex flex-col items-center justify-center px-6 py-2 transition-all active:scale-90 ${showHistory ? 'text-blue-900 bg-blue-50/50 rounded-xl' : 'text-slate-400'}`}>
            <History size={22} />
            <span className="text-[10px] font-bold uppercase tracking-widest mt-1">History</span>
          </button>
        </nav>
      </div>
      <input type="file" accept="image/*" className="hidden" ref={fileInputRef} onChange={(e) => onSelectFile(e, activeUploadType)} />
      
      {/* EXTRACTION COMPLETE TOAST */}
      {showExtractionToast && (
        <div className="fixed bottom-24 md:bottom-10 left-1/2 -translate-x-1/2 z-[100] bg-blue-900 text-white px-6 py-3 rounded-full shadow-2xl font-bold text-sm flex items-center gap-3 animate-in fade-in slide-in-from-bottom-4 duration-300">
          <Sparkles size={18} className="text-blue-300" />
          <span>Generation Complete!</span>
          <button onClick={() => setShowExtractionToast(false)} className="ml-2 p-1 hover:bg-white/10 rounded-full transition-colors">
            <X size={14} />
          </button>
        </div>
      )}

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

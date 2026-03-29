'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Camera, Columns2, Smartphone, ChevronRight, Eye, EyeOff, Loader2, CheckCircle2, X, Scissors, ArrowUpRight, MessageSquareText, Image as ImageIcon, ClipboardPaste, BrainCircuit, Trash2, Upload, FileText, PlusCircle, Type, ChevronDown, ChevronUp, LogOut } from 'lucide-react';
import { supabase, SESSION_CHANNEL_PREFIX } from '@/lib/supabase';
import Latex from 'react-latex-next';
import ReactCrop, { type Crop, PixelCrop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import 'katex/dist/katex.min.css';

// --- Types ---
type SessionStatus = 'idle' | 'waiting' | 'uploading' | 'cropping' | 'processing' | 'ready';
type ImageType = 'question' | 'solution';

interface QuestionData {
  id?: string;
  questionImageUrl: string | null;
  questionText: string;
  solutionImageUrl: string | null;
  solutionText: string;
  extractedText: string;
  isQuestionTextMode?: boolean;
  isSolutionTextMode?: boolean;
  variations: { category: string; text: string; solution: string; }[];
}

export default function QuestionBreaker() {
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
  
  const [data, setData] = useState<QuestionData>({ 
    questionImageUrl: null, 
    questionText: '',
    solutionImageUrl: null, 
    solutionText: '',
    extractedText: '', 
    variations: [] 
  });

  // Workflow States
  const [isQuestionTextMode, setIsQuestionTextMode] = useState(false);
  const [isSolutionTextMode, setIsSolutionTextMode] = useState(true);
  const [isSolutionEnabled, setIsSolutionEnabled] = useState(false);

  // Media State
  const [pastedFile, setPastedFile] = useState<File | null>(null);
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
      }
      setIsInitializing(false);
    };
    bootstrap();
  }, []);

  const syncLatestData = async (rId: string) => {
    const { data: qData } = await supabase.from('questions').select('*').eq('room_id', rId).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (qData) {
      updateLocalState(qData);
    }
  };

  const updateLocalState = (newData: any) => {
    setData({
      id: newData.id,
      questionImageUrl: newData.question_image_url,
      questionText: newData.question_text || '',
      solutionImageUrl: newData.solution_image_url,
      solutionText: newData.solution_text || '',
      extractedText: newData.extracted_text || '',
      variations: newData.variations || []
    });
    
    // Auto-switch UI mode to match database
    setIsQuestionTextMode(!!newData.is_question_text_mode);
    setIsSolutionTextMode(!!newData.is_solution_text_mode);
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
        updateLocalState(newData);
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
    } else alert("Room not found.");
  };

  const resetSession = () => { localStorage.clear(); window.location.reload(); };

  // --- 3. DATABASE UPDATES ---

  const saveToDb = async (updates: Partial<QuestionData>, newStatus?: string) => {
    if (!roomId) return;
    const payload = {
      room_id: roomId,
      question_image_url: updates.questionImageUrl ?? data.questionImageUrl,
      question_text: updates.questionText ?? data.questionText,
      solution_image_url: updates.solutionImageUrl ?? data.solutionImageUrl,
      solution_text: updates.solutionText ?? data.solutionText,
      is_question_text_mode: isQuestionTextMode,
      is_solution_text_mode: isSolutionTextMode,
      status: newStatus || 'waiting'
    };
    if (data.id) { await supabase.from('questions').update(payload).eq('id', data.id); }
    else { const { data: created } = await supabase.from('questions').insert([payload]).select().single(); if (created) setData(p => ({ ...p, id: created.id })); }
  };

  // --- 4. CORE AI HANDLER ---

  const handleProcessWithAI = async () => {
    if (!roomId) return;
    setStatus('processing');
    setAiStep('Connecting to Gemini 3.1...');
    
    // 1. Force a sync so phone sees the spinner
    await saveToDb({}, 'processing');

    try {
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
      const result = await resp.json();
      if (result.error) { 
        setAiStep('Error: ' + result.error); 
        if (result.raw) setDebugLog(result.raw); 
        await saveToDb({}, 'waiting');
        return; 
      }

      // 2. SAVE RESULTS TO DB (This instantly updates the phone/iPad)
      await supabase.from('questions').update({ 
        extracted_text: result.extractedText, 
        variations: result.variations, 
        status: 'ready'
      }).eq('id', data.id);

    } catch (err: any) {
      setAiStep('AI Handshake Failed');
      await saveToDb({}, 'waiting');
      setTimeout(() => setStatus('waiting'), 3000);
    }
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
    try {
      const canvas = document.createElement('canvas');
      const scaleX = imgRef.current.naturalWidth / imgRef.current.width;
      const scaleY = imgRef.current.naturalHeight / imgRef.current.height;
      canvas.width = completedCrop.width * scaleX; canvas.height = completedCrop.height * scaleY;
      const ctx = canvas.getContext('2d')!;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(imgRef.current, completedCrop.x * scaleX, completedCrop.y * scaleY, completedCrop.width * scaleX, completedCrop.height * scaleY, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(async (blob) => { if (blob) await uploadToSupabase(new File([blob], `crop.jpg`, { type: 'image/jpeg' }), activeUploadType); }, 'image/jpeg', 1.0);
    } catch (e) { setStatus('waiting'); }
  };

  const handleSkipCrop = async () => {
    if (!rawFile) return;
    setStatus('uploading');
    await uploadToSupabase(rawFile, activeUploadType);
  };

  if (isInitializing) return <div className="min-h-screen bg-slate-50 flex items-center justify-center"><Loader2 className="animate-spin text-indigo-600" /></div>;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col text-slate-900 font-sans">
      {/* GLOBAL CROP OVERLAY */}
      {status === 'cropping' && imgSrc && (
        <div className="fixed inset-0 z-[100] bg-slate-900 flex flex-col">
          <div className="p-4 flex justify-between items-center text-white bg-slate-950"><button onClick={() => setStatus('waiting')}><X /></button><span className="font-bold text-xs uppercase">Crop {activeUploadType}</span><button onClick={handleConfirmCrop} className="bg-indigo-600 px-6 py-2 rounded-full font-black text-xs uppercase shadow-lg">Confirm</button></div>
          <div className="flex-1 overflow-auto bg-black flex items-center justify-center p-4"><ReactCrop crop={crop} onChange={c => setCrop(c)} onComplete={c => setCompletedCrop(c)} className="max-h-full"><img ref={imgRef} src={imgSrc} alt="Crop" className="max-w-full max-h-[70vh] object-contain" /></ReactCrop></div>
          <div className="p-4 bg-slate-950 text-center"><button onClick={handleSkipCrop} className="w-full max-w-xs p-3 bg-white/5 text-slate-400 text-[10px] font-black uppercase rounded-xl border border-white/10">Skip Crop & Upload</button></div>
        </div>
      )}

      {!roomId ? (
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
        <div className="flex-1 flex flex-col relative">
          <header className="h-16 border-b bg-white flex items-center justify-between px-8 shrink-0 shadow-sm"><div className="flex items-center gap-3 font-black text-indigo-600 italic text-xl underline decoration-indigo-100 decoration-4">QB</div><div className="flex items-center gap-4"><div className="px-4 py-1.5 bg-slate-100 rounded-full text-sm font-mono font-bold text-indigo-600 uppercase tracking-widest">CODE: {pairingCode}</div><button onClick={resetSession} className="text-xs font-semibold text-slate-400 hover:text-red-500 flex items-center gap-1"><LogOut size={14}/> Reset</button></div></header>
          <main className="flex-1 flex flex-col md:flex-row overflow-hidden text-left text-balance">
            <div className="w-full md:w-1/2 border-r bg-slate-50/50 flex flex-col relative overflow-y-auto pb-40">
              <div className="p-8 space-y-10">
                <div className="space-y-3">
                  <div className="flex justify-between items-center"><h4 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-indigo-500"></div> The Question</h4><div className="flex items-center gap-2"><button onClick={() => { const next = !isQuestionTextMode; setIsQuestionTextMode(next); saveToDb({ isQuestionTextMode: next }); }} className="text-[10px] font-black uppercase text-indigo-600 hover:underline">{isQuestionTextMode ? 'Switch to Image' : 'Switch to Text'}</button>{(data.questionImageUrl || data.questionText) && <button onClick={() => { setData(p => ({ ...p, questionImageUrl: null, questionText: '' })); saveToDb({ questionImageUrl: null, questionText: '' }); }} className="text-slate-300 hover:text-red-500"><Trash2 size={14}/></button>}</div></div>
                  {isQuestionTextMode ? ( <textarea placeholder="Paste or type question here..." value={data.questionText} onChange={(e) => { const v = e.target.value; setData(p => ({ ...p, questionText: v })); }} onBlur={(e) => saveToDb({ questionText: e.target.value })} className="w-full min-h-[150px] bg-white rounded-2xl p-5 text-lg border-2 border-indigo-100 focus:border-indigo-500 outline-none transition-all shadow-sm whitespace-pre-wrap" /> ) : ( data.questionImageUrl ? <img src={data.questionImageUrl} alt="Question" className="w-full rounded-2xl shadow-2xl border border-white mx-auto" /> : ( <button onClick={() => { setActiveUploadType('question'); fileInputRef.current?.click(); }} className="w-full aspect-video bg-white/50 rounded-2xl border-2 border-dashed border-slate-200 flex flex-col items-center justify-center text-slate-300 space-y-2 hover:bg-white transition-all group"><Upload size={32} className="opacity-20 group-hover:scale-110 transition-transform" /><span className="text-xs font-bold uppercase tracking-widest text-center px-10 text-balance">Click or Paste Question Image</span></button> ) )}
                </div>
                <div className="space-y-3">
                  <div className="flex justify-between items-center"><h4 className="text-[10px] font-black text-indigo-400 uppercase tracking-[0.2em] flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-indigo-400"></div> Solution Reference</h4><div className="flex items-center gap-2">{isSolutionEnabled && <button onClick={() => { const next = !isSolutionTextMode; setIsSolutionTextMode(next); saveToDb({ isSolutionTextMode: next }); }} className="text-[10px] font-black uppercase text-indigo-400 hover:underline">{isSolutionTextMode ? 'Switch to Image' : 'Switch to Text'}</button>}{isSolutionEnabled && <button onClick={() => { setIsSolutionEnabled(false); setData(p => ({ ...p, solutionImageUrl: null, solutionText: '' })); saveToDb({ solutionImageUrl: null, solutionText: '' }); }} className="text-slate-300 hover:text-red-500"><Trash2 size={14}/></button>}</div></div>
                  {!isSolutionEnabled ? ( <button onClick={() => setIsSolutionEnabled(true)} className="w-full p-6 border-2 border-dashed border-slate-200 rounded-2xl text-slate-400 flex items-center justify-center gap-3 hover:bg-white hover:border-indigo-100 transition-all group"><PlusCircle size={20} className="group-hover:rotate-90 transition-transform" /><span className="text-[10px] font-black uppercase tracking-widest text-balance">Add Solution Context (Optional)</span></button> ) : ( isSolutionTextMode ? ( <textarea placeholder="Paste solution steps..." value={data.solutionText} onChange={(e) => { const v = e.target.value; setData(p => ({ ...p, solutionText: v })); }} onBlur={(e) => saveToDb({ solutionText: e.target.value })} className="w-full min-h-[150px] bg-indigo-50/30 rounded-2xl p-5 text-sm border-2 border-indigo-50 focus:border-indigo-400 outline-none transition-all shadow-sm whitespace-pre-wrap" /> ) : ( data.solutionImageUrl ? <img src={data.solutionImageUrl} alt="Solution" className="w-full rounded-2xl shadow-lg border border-white opacity-80 mx-auto" /> : ( <button onClick={() => { setActiveUploadType('solution'); fileInputRef.current?.click(); }} className="w-full aspect-video bg-indigo-50/20 rounded-2xl border-2 border-dashed border-indigo-100 flex flex-col items-center justify-center text-indigo-300 space-y-2 hover:bg-white transition-all group"><Upload size={32} className="opacity-20 group-hover:scale-110 transition-transform" /><span className="text-xs font-bold uppercase tracking-widest text-center px-10 text-balance">Click or Paste Solution Image</span></button> ) ) )}
                </div>
                {debugLog && <div className="p-4 bg-red-50 rounded-2xl border border-red-100 text-[10px] font-mono text-red-600 overflow-auto max-h-40 whitespace-pre-wrap text-left"><div className="font-bold uppercase mb-1 text-red-800">API Diagnostic:</div>{debugLog}</div>}
              </div>
              <div className="absolute bottom-0 left-0 right-0 p-8 bg-gradient-to-t from-slate-50 via-slate-50 to-transparent flex flex-col items-center">
                {(data.questionImageUrl || data.questionText) && status !== 'processing' && status !== 'ready' && ( <button onClick={handleProcessWithAI} className="group bg-slate-900 hover:bg-black text-white px-12 py-5 rounded-full font-black text-xl shadow-2xl flex items-center gap-4 active:scale-95 transition-all shadow-indigo-100"><BrainCircuit className="text-indigo-400 group-hover:rotate-12 transition-transform" />Submit to Gemini 3.1</button> )}
                {!(data.questionImageUrl || data.questionText) && <div className="flex items-center gap-3 text-slate-400 animate-pulse font-bold text-[10px] uppercase tracking-[0.2em] text-center"><Smartphone size={16} /> Awaiting Input from<br/>any connected device</div>}
              </div>
              {status === 'processing' && <div className="absolute inset-0 bg-white/80 backdrop-blur-sm flex flex-col items-center justify-center z-20 space-y-4 text-center"><Loader2 className="w-10 h-10 text-indigo-600 animate-spin" /><p className="font-bold text-indigo-950 uppercase tracking-widest text-xs">AI Logic Engine Active</p><p className="text-[10px] uppercase font-bold text-slate-400 animate-pulse bg-white px-3 py-1 rounded-full shadow-sm">{aiStep}</p></div>}
            </div>
            
            <div className="w-full md:w-1/2 bg-white flex flex-col overflow-y-auto">
              <div className="p-4 border-b sticky top-0 bg-white/90 backdrop-blur z-10 flex justify-between items-center px-8"><h3 className="text-sm font-bold uppercase tracking-widest text-slate-400 italic">Variations</h3><div className="bg-indigo-50 text-indigo-600 px-2 py-1 rounded text-[10px] font-black uppercase tracking-tighter shadow-sm">Gemini 3.1 Pro</div></div>
              <div className="p-8 space-y-4 text-left">
                {status === 'ready' ? (
                  data.variations.map((v, i) => (
                    <div key={i} className="border-2 border-slate-50 rounded-3xl overflow-hidden transition-all duration-300 hover:border-indigo-100">
                      <button onClick={() => setExpandedVariations(prev => ({ ...prev, [i]: !prev[i] }))} className={`w-full p-6 flex justify-between items-center transition-colors ${expandedVariations[i] ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-100' : 'bg-slate-50 text-slate-600 hover:bg-slate-100'}`}><div className="flex items-center gap-3"><span className={`text-[10px] font-black px-2 py-0.5 rounded uppercase tracking-wider ${expandedVariations[i] ? 'bg-white text-indigo-600' : 'bg-indigo-600 text-white'}`}>{v.category}</span><span className="font-bold text-sm tracking-tight">Expand Variation</span></div>{expandedVariations[i] ? <ChevronUp size={18} /> : <ChevronDown size={18} />}</button>
                      {expandedVariations[i] && ( <div className="p-8 space-y-6 animate-in slide-in-from-top-2 duration-300 text-left"><div className="text-slate-700 leading-relaxed text-lg prose prose-indigo whitespace-pre-wrap text-left"><Latex>{v.text}</Latex></div><button onClick={() => setShowSolutions(p => ({ ...p, [i]: !p[i] }))} className="flex items-center gap-2 text-sm font-bold text-indigo-600 bg-indigo-50 px-4 py-2 rounded-full hover:bg-indigo-100 active:scale-95 transition-all text-left shadow-sm">{showSolutions[i] ? <EyeOff size={16} /> : <Eye size={16} />} {showSolutions[i] ? 'Hide Solution' : 'Show Solution'}</button>{showSolutions[i] && <div className="mt-4 p-8 bg-slate-50 rounded-3xl border border-slate-100 text-slate-600 shadow-inner animate-in zoom-in-95 text-left"><div className="font-bold text-xs uppercase text-slate-400 mb-4 tracking-widest text-center">Pedagogical Solution</div><div className="prose prose-slate max-w-none text-left whitespace-pre-wrap"><Latex>{v.solution}</Latex></div></div>}</div> )}
                    </div>
                  ))
                ) : ( <div className="space-y-6 text-center py-20">{[1,2,3].map(i => <div key={i} className="space-y-3 animate-pulse opacity-20"><div className="h-4 w-24 bg-slate-100 rounded mx-auto"></div><div className="h-20 w-full bg-slate-50 rounded-2xl"></div></div>)}<p className="text-[10px] font-black text-slate-200 uppercase tracking-widest mt-4 text-center">Awaiting AI Logic</p></div> )}
              </div>
            </div>
          </main>
          <input type="file" accept="image/*" className="hidden" ref={fileInputRef} onChange={(e) => onSelectFile(e, activeUploadType)} />
        </div>
      )}
    </div>
  );
}

async function getCroppedImg(image: HTMLImageElement, pixelCrop: any): Promise<Blob> {
  const canvas = document.createElement('canvas');
  const scaleX = image.naturalWidth / image.width;
  const scaleY = image.naturalHeight / image.height;
  canvas.width = pixelCrop.width * scaleX; canvas.height = pixelCrop.height * scaleY;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, pixelCrop.x * scaleX, pixelCrop.y * scaleY, pixelCrop.width * scaleX, pixelCrop.height * scaleY, 0, 0, canvas.width, canvas.height);
  return new Promise((res) => canvas.toBlob((b) => res(b!), 'image/jpeg', 1.0));
}

'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Camera, Columns2, Smartphone, ChevronRight, Eye, EyeOff, Loader2, CheckCircle2, X, Scissors, ArrowUpRight, MessageSquareText, Image as ImageIcon, ClipboardPaste, BrainCircuit, Trash2, Upload, FileText, PlusCircle, Type, ChevronDown, ChevronUp, Sparkles, Activity } from 'lucide-react';
import { supabase, SESSION_CHANNEL_PREFIX } from '@/lib/supabase';
import Latex from 'react-latex-next';
import ReactCrop, { type Crop, PixelCrop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import 'katex/dist/katex.min.css';

// --- Types ---
type SessionStatus = 'idle' | 'waiting' | 'uploading' | 'cropping' | 'processing' | 'ready';
type ImageType = 'question' | 'solution';

interface QuestionData {
  questionImageUrl: string | null;
  questionText: string;
  solutionImageUrl: string | null;
  solutionText: string;
  extractedText: string;
  variations: { category: string; text: string; solution: string; }[];
}

export default function QuestionBreaker() {
  const [sessionId, setSessionId] = useState<string>('');
  const [viewMode, setViewMode] = useState<'desktop' | 'mobile' | null>(null);
  const [status, setStatus] = useState<SessionStatus>('idle');
  const [aiStep, setAiStep] = useState<string>('idle');
  const [debugLog, setDebugLog] = useState<string>('');
  
  // Visibility States
  const [expandedVariations, setExpandedVariations] = useState<Record<number, boolean>>({});
  const [showSolutions, setShowSolutions] = useState<Record<number, boolean>>({});
  
  const channelRef = useRef<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [data, setData] = useState<QuestionData>({ 
    questionImageUrl: null, 
    questionText: '',
    solutionImageUrl: null, 
    solutionText: '',
    extractedText: '', 
    variations: [] 
  });

  // Laptop Workflow State
  const [isQuestionTextMode, setIsQuestionTextMode] = useState(false);
  const [isSolutionTextMode, setIsSolutionTextMode] = useState(true);
  const [isSolutionEnabled, setIsSolutionEnabled] = useState(false);

  // Paste / Cropping State
  const [pastedFile, setPastedFile] = useState<File | null>(null);
  const [activeUploadType, setActiveUploadType] = useState<ImageType>('question');
  const [imgSrc, setImgSrc] = useState('');
  const imgRef = useRef<HTMLImageElement>(null);
  const [crop, setCrop] = useState<Crop>();
  const [completedCrop, setCompletedCrop] = useState<PixelCrop>();
  const [rawFile, setRawFile] = useState<File | null>(null);

  useEffect(() => {
    return () => { if (channelRef.current) supabase.removeChannel(channelRef.current); };
  }, []);

  const toggleVariation = (index: number) => {
    setExpandedVariations(prev => ({ ...prev, [index]: !prev[index] }));
  };

  const handlePasteChoice = async (type: ImageType) => {
    if (!pastedFile) return;
    setStatus('uploading');
    await uploadToSupabase(pastedFile, type);
    setPastedFile(null);
    if (type === 'solution') { setIsSolutionEnabled(true); setIsSolutionTextMode(false); }
  };

  const subscribeToSession = (id: string, isHost: boolean) => {
    if (!supabase) return;
    const channel = supabase.channel(`${SESSION_CHANNEL_PREFIX}${id}`, { config: { broadcast: { self: true } } });
    channel
      .on('broadcast', { event: 'IMAGE_UPLOADED' }, ({ payload }: { payload: { imageUrl: string, type: ImageType } }) => {
        setData(prev => {
          const newData = { ...prev };
          if (payload.type === 'question') { newData.questionImageUrl = payload.imageUrl; setIsQuestionTextMode(false); }
          if (payload.type === 'solution') { newData.solutionImageUrl = payload.imageUrl; setIsSolutionEnabled(true); setIsSolutionTextMode(false); }
          return newData;
        });
        setStatus('waiting');
      })
      .on('broadcast', { event: 'VARIATIONS_READY' }, ({ payload }: { payload: any }) => {
        setData(prev => ({ ...prev, extractedText: payload.extractedText, variations: payload.variations }));
        setStatus('ready');
      })
      .subscribe((s: string) => { if (s === 'SUBSCRIBED' && !isHost) channel.send({ type: 'broadcast', event: 'USER_JOINED', payload: { device: 'mobile' } }); });
    channelRef.current = channel;
  };

  const startSession = () => {
    const newId = Math.random().toString(36).substring(2, 8).toUpperCase();
    const formattedId = `${newId.slice(0,3)}-${newId.slice(3)}`;
    setSessionId(formattedId);
    setViewMode('desktop');
    setStatus('waiting');
    subscribeToSession(formattedId, true);
  };

  const joinSession = (id: string) => {
    let cleanId = id.toUpperCase().replace(/[^A-Z0-9]/g, ''); 
    if (cleanId.length === 6) cleanId = `${cleanId.slice(0, 3)}-${cleanId.slice(3)}`;
    if (cleanId.length === 7) { setSessionId(cleanId); setViewMode('mobile'); setStatus('waiting'); subscribeToSession(cleanId, false); }
    else alert("Please enter a 6-digit ID.");
  };

  const onSelectFile = (e: React.ChangeEvent<HTMLInputElement>, type: ImageType) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      setRawFile(file);
      setActiveUploadType(type);
      const reader = new FileReader();
      reader.onload = () => { setImgSrc(reader.result?.toString() || ''); setStatus('cropping'); };
      reader.readAsDataURL(file);
    }
  };

  const handleConfirmCrop = async () => {
    if (!imgRef.current || !completedCrop) return;
    setStatus('uploading');
    try {
      const croppedBlob = await getCroppedImg(imgRef.current, completedCrop);
      const file = new File([croppedBlob], `${activeUploadType}-${Date.now()}.jpg`, { type: 'image/jpeg' });
      await uploadToSupabase(file, activeUploadType);
    } catch (e: any) { alert("Crop failed"); setStatus('waiting'); }
  };

  const handleSkipCrop = async () => {
    if (!rawFile) return;
    setStatus('uploading');
    try {
      const img = new Image();
      img.src = URL.createObjectURL(rawFile);
      await new Promise((resolve) => (img.onload = resolve));
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      canvas.toBlob(async (blob) => {
        if (blob) {
          const file = new File([blob], `${activeUploadType}-${Date.now()}.jpg`, { type: 'image/jpeg' });
          await uploadToSupabase(file, activeUploadType);
        }
      }, 'image/jpeg', 0.95);
    } catch (e) { await uploadToSupabase(rawFile, activeUploadType); }
  };

  const uploadToSupabase = async (file: File, type: ImageType) => {
    try {
      const fileName = `${sessionId}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.]/g, '_')}`;
      const { error } = await supabase.storage.from('questions').upload(fileName, file);
      if (error) throw error;
      const { data: { publicUrl } } = supabase.storage.from('questions').getPublicUrl(fileName);
      channelRef.current.send({ type: 'broadcast', event: 'IMAGE_UPLOADED', payload: { imageUrl: publicUrl, type } });
      
      if (viewMode === 'desktop') {
        setData(prev => ({ ...prev, questionImageUrl: type === 'question' ? publicUrl : prev.questionImageUrl, solutionImageUrl: type === 'solution' ? publicUrl : prev.solutionImageUrl }));
        if (type === 'question') setIsQuestionTextMode(false);
        if (type === 'solution') setIsSolutionTextMode(false);
      }
      setStatus('waiting');
      setImgSrc('');
    } catch (err: any) { alert('Upload failed: ' + err.message); setStatus('waiting'); }
  };

  const handleProcessImage = async () => {
    const hasQuestion = isQuestionTextMode ? data.questionText : data.questionImageUrl;
    if (!hasQuestion) return;
    setStatus('processing');
    setAiStep('Initializing Neural Engine...');
    setDebugLog('');
    
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
      if (result.error) { setAiStep('Error: ' + result.error); if (result.raw) setDebugLog(result.raw); return; }
      setData(prev => ({ ...prev, extractedText: result.extractedText, variations: result.variations }));
      setStatus('ready');
      channelRef.current.send({ type: 'broadcast', event: 'VARIATIONS_READY', payload: result });
    } catch (err: any) { setAiStep('Connection Failed'); setTimeout(() => setStatus('waiting'), 3000); }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col text-slate-900 font-sans">
      {/* GLOBAL CROPPING OVERLAY */}
      {status === 'cropping' && imgSrc && (
        <div className="fixed inset-0 z-[100] bg-slate-900 flex flex-col">
          <div className="p-4 flex justify-between items-center text-white border-b border-white/10 bg-slate-950"><button onClick={() => setStatus('waiting')} className="p-2"><X /></button><span className="font-bold text-xs uppercase tracking-widest text-indigo-400">Crop {activeUploadType}</span><button onClick={handleConfirmCrop} className="bg-indigo-600 px-6 py-2 rounded-full font-black text-xs uppercase shadow-lg">Confirm</button></div>
          <div className="flex-1 overflow-auto bg-black flex items-center justify-center p-4"><ReactCrop crop={crop} onChange={c => setCrop(c)} onComplete={c => setCompletedCrop(c)} className="max-h-full"><img ref={imgRef} src={imgSrc} alt="Crop" className="max-w-full max-h-[70vh] object-contain" /></ReactCrop></div>
          <div className="p-4 bg-slate-950 text-center"><button onClick={handleSkipCrop} className="w-full max-w-xs p-3 bg-white/5 text-slate-400 text-[10px] font-black uppercase rounded-xl border border-white/10">Skip Crop & Upload</button></div>
        </div>
      )}

      {/* 1. INITIAL VIEW */}
      {viewMode === null && (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
          <div className="max-w-md w-full space-y-8 bg-white p-10 rounded-3xl shadow-xl border border-slate-100"><h1 className="text-4xl font-black text-indigo-600 italic">QB.</h1><button onClick={startSession} className="group flex items-center justify-between w-full p-6 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl transition-all shadow-lg"><div className="flex items-center gap-4 text-left"><Columns2 size={24} /><div className="font-bold text-lg">Host Session<div className="text-indigo-100 text-sm font-medium">On your laptop</div></div></div><ChevronRight className="opacity-50" /></button>
            <div className="relative py-2 text-xs text-slate-400 uppercase tracking-widest flex items-center justify-center gap-4"><div className="h-px flex-1 bg-slate-100"></div>or<div className="h-px flex-1 bg-slate-100"></div></div>
            <div className="space-y-3"><input type="text" placeholder="Enter 6-digit ID" className="w-full p-4 rounded-xl border-2 border-slate-100 text-center font-mono text-xl uppercase tracking-widest focus:border-indigo-500 outline-none" onChange={(e) => setSessionId(e.target.value.toUpperCase())} value={sessionId} /><button onClick={() => joinSession(sessionId)} className="w-full p-5 bg-indigo-600 text-white rounded-2xl font-black shadow-xl">Join Session</button></div>
          </div>
        </div>
      )}

      {/* 2. MOBILE VIEW */}
      {viewMode === 'mobile' && (
        <div className="flex-1 flex flex-col bg-white overflow-hidden pb-10">
          <header className="p-4 border-b flex justify-between items-center bg-slate-50/50"><strong>QB Mobile</strong><div className="px-3 py-1 bg-white border rounded-full text-xs font-mono font-bold text-slate-500 uppercase">ID: {sessionId}</div></header>
          <main className="flex-1 flex flex-col p-6 space-y-6 text-center relative overflow-y-auto">
            {status === 'processing' || status === 'uploading' ? (
              <div className="flex-1 flex flex-col items-center justify-center space-y-4"><Loader2 className="w-12 h-12 text-indigo-600 animate-spin" /><p className="font-bold text-lg text-indigo-900">{status === 'uploading' ? 'Syncing...' : 'AI is Thinking...'}</p></div>
            ) : status === 'ready' ? (
              <div className="flex-1 flex flex-col items-center justify-center space-y-6 animate-in fade-in zoom-in"><div className="w-20 h-20 bg-green-50 text-green-600 rounded-full flex items-center justify-center mx-auto"><CheckCircle2 size={32} /></div><h2 className="text-2xl font-bold text-indigo-900">Variations Ready!</h2><button onClick={() => { setStatus('waiting'); }} className="p-5 bg-indigo-600 text-white rounded-2xl font-black w-full shadow-lg">Upload Another</button></div>
            ) : (
              <div className="flex-1 flex flex-col justify-center gap-6"><div className="space-y-4 p-6 bg-slate-50 rounded-3xl border border-slate-100"><div className="text-sm font-black text-indigo-600 uppercase tracking-widest">Question</div><label className="flex items-center justify-center w-full gap-3 p-5 bg-indigo-600 text-white rounded-2xl font-black text-lg active:scale-95 cursor-pointer shadow-lg"><Camera size={20} /> Snap Question<input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => onSelectFile(e, 'question')} /></label></div><div className="h-px bg-slate-100 mx-10"></div><div className="space-y-4 p-6 bg-white border border-slate-100 rounded-3xl shadow-sm"><div className="text-sm font-black text-slate-400 uppercase tracking-widest">Solution (Optional)</div><label className="flex items-center justify-center w-full gap-3 p-5 bg-white border-2 border-slate-100 text-slate-600 rounded-2xl font-black text-lg active:scale-95 cursor-pointer"><ImageIcon size={20} /> Add Answer Key<input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => onSelectFile(e, 'solution')} /></label></div></div>
            )}
          </main>
        </div>
      )}

      {/* 3. DESKTOP VIEW */}
      {viewMode === 'desktop' && (
        <div className="flex-1 flex flex-col relative">
          {pastedFile && (
            <div className="absolute inset-0 z-50 bg-indigo-600/95 backdrop-blur-lg flex flex-col items-center justify-center space-y-8 animate-in fade-in duration-300">
              <div className="text-white text-center space-y-2"><ClipboardPaste size={64} className="mx-auto opacity-50" /><h2 className="text-3xl font-black italic">Image Pasted!</h2><p className="text-indigo-100 font-medium">How should we use this image?</p></div>
              <div className="grid grid-cols-2 gap-4 w-full max-w-lg px-6"><button onClick={() => handlePasteChoice('question')} className="bg-white text-indigo-600 p-8 rounded-3xl font-black text-xl shadow-2xl hover:scale-105 transition-all flex flex-col items-center gap-3"><Camera size={32} /> Save as Question</button><button onClick={() => handlePasteChoice('solution')} className="bg-indigo-900/40 text-white p-8 rounded-3xl font-black text-xl shadow-2xl hover:scale-105 transition-all border border-white/20 flex flex-col items-center gap-3"><ImageIcon size={32} /> Save as Solution</button></div>
              <button onClick={() => setPastedFile(null)} className="text-indigo-200 font-bold uppercase tracking-widest text-xs underline">Cancel Paste</button>
            </div>
          )}
          
          <header className="h-24 border-b bg-white flex items-center justify-between px-8 shrink-0 relative z-20 shadow-sm">
            <div className="flex items-center gap-3 font-black text-indigo-600 italic text-xl underline decoration-indigo-100 decoration-4">QB</div>
            
            {/* CENTRAL STATUS HUB */}
            <div className="flex flex-col items-center gap-1.5">
              {status === 'processing' ? (
                <div className="flex items-center gap-3 bg-indigo-50 border border-indigo-100 px-6 py-2 rounded-full animate-in zoom-in duration-300">
                  <Loader2 size={16} className="text-indigo-600 animate-spin" />
                  <span className="text-[10px] font-black uppercase tracking-widest text-indigo-600">{aiStep}</span>
                  <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse"></div>
                </div>
              ) : status === 'ready' ? (
                <div className="flex items-center gap-2 bg-green-50 border border-green-100 px-6 py-2 rounded-full animate-in fade-in duration-500">
                  <CheckCircle2 size={16} className="text-green-600" />
                  <span className="text-[10px] font-black uppercase tracking-widest text-green-600">Break Complete</span>
                </div>
              ) : (
                <div className="flex items-center gap-3 text-slate-300">
                  <Activity size={14} />
                  <span className="text-[10px] font-bold uppercase tracking-[0.3em]">System Standby</span>
                </div>
              )}
            </div>

            <div className="flex items-center gap-4">
              <div className="px-4 py-1.5 bg-slate-100 rounded-full text-sm font-mono font-bold text-indigo-600 uppercase tracking-widest">{sessionId}</div>
              <button onClick={() => window.location.reload()} className="text-xs font-semibold text-slate-400 hover:text-slate-600">End Session</button>
            </div>
          </header>
          
          <main className="flex-1 flex overflow-hidden">
            <div className="w-1/2 border-r bg-slate-50/50 flex flex-col relative">
              <div className="flex-1 overflow-y-auto p-8 space-y-10 pb-40">
                {/* QUESTION ZONE */}
                <div className="space-y-3">
                  <div className="flex justify-between items-center"><h4 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-indigo-500"></div> The Question</h4><div className="flex items-center gap-2"><button onClick={() => setIsQuestionTextMode(!isQuestionTextMode)} className="text-[10px] font-black uppercase text-indigo-600 hover:underline">{isQuestionTextMode ? 'Switch to Image' : 'Switch to Text'}</button>{(data.questionImageUrl || data.questionText) && <button onClick={() => setData(p => ({ ...p, questionImageUrl: null, questionText: '' }))} className="text-slate-300 hover:text-red-500"><Trash2 size={14}/></button>}</div></div>
                  {isQuestionTextMode ? ( <textarea placeholder="Paste or type question here..." value={data.questionText} onChange={(e) => setData(p => ({ ...p, questionText: e.target.value }))} className="w-full min-h-[150px] bg-white rounded-2xl p-5 text-lg border-2 border-indigo-100 focus:border-indigo-500 outline-none transition-all shadow-sm whitespace-pre-wrap" /> ) : ( data.questionImageUrl ? <img src={data.questionImageUrl} alt="Question" className="w-full rounded-2xl shadow-2xl border border-white" /> : ( <button onClick={() => { setActiveUploadType('question'); fileInputRef.current?.click(); }} className="w-full aspect-video bg-white/50 rounded-2xl border-2 border-dashed border-slate-200 flex flex-col items-center justify-center text-slate-300 space-y-2 hover:bg-white hover:border-indigo-200 transition-all group"><Upload size={32} className="opacity-20 group-hover:scale-110 transition-transform" /><span className="text-xs font-bold uppercase tracking-widest">Click or Paste Question Image</span></button> ) )}
                </div>
                {/* SOLUTION ZONE */}
                <div className="space-y-3">
                  <div className="flex justify-between items-center"><h4 className="text-[10px] font-black text-indigo-400 uppercase tracking-[0.2em] flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-indigo-400"></div> Solution Reference</h4><div className="flex items-center gap-2">{isSolutionEnabled && <button onClick={() => setIsSolutionTextMode(!isSolutionTextMode)} className="text-[10px] font-black uppercase text-indigo-400 hover:underline">{isSolutionTextMode ? 'Switch to Image' : 'Switch to Text'}</button>}{isSolutionEnabled && <button onClick={() => { setIsSolutionEnabled(false); setData(p => ({ ...p, solutionImageUrl: null, solutionText: '' })); }} className="text-slate-300 hover:text-red-500"><Trash2 size={14}/></button>}</div></div>
                  {!isSolutionEnabled ? ( <button onClick={() => setIsSolutionEnabled(true)} className="w-full p-6 border-2 border-dashed border-slate-200 rounded-2xl text-slate-400 flex items-center justify-center gap-3 hover:bg-white hover:border-indigo-100 transition-all group"><PlusCircle size={20} className="group-hover:rotate-90 transition-transform" /><span className="text-[10px] font-black uppercase tracking-widest">Add Solution Context (Optional)</span></button> ) : ( isSolutionTextMode ? ( <textarea placeholder="Paste or type solution steps here..." value={data.solutionText} onChange={(e) => setData(p => ({ ...p, solutionText: e.target.value }))} className="w-full min-h-[150px] bg-indigo-50/30 rounded-2xl p-5 text-sm border-2 border-indigo-50 focus:border-indigo-400 outline-none transition-all shadow-sm whitespace-pre-wrap" /> ) : ( data.solutionImageUrl ? <img src={data.solutionImageUrl} alt="Solution" className="w-full rounded-2xl shadow-lg border border-white opacity-80" /> : ( <button onClick={() => { setActiveUploadType('solution'); fileInputRef.current?.click(); }} className="w-full aspect-video bg-indigo-50/20 rounded-2xl border-2 border-dashed border-indigo-100 flex flex-col items-center justify-center text-indigo-300 space-y-2 hover:bg-white hover:border-indigo-200 transition-all group"><Upload size={32} className="opacity-20 group-hover:scale-110 transition-transform" /><span className="text-xs font-bold uppercase tracking-widest">Click or Paste Solution Image</span></button> ) ) )}
                </div>
                {debugLog && <div className="p-4 bg-red-50 rounded-2xl border border-red-100 text-[10px] font-mono text-red-600 overflow-auto max-h-40 whitespace-pre-wrap"><div className="font-bold uppercase mb-1">Diagnostic Info:</div>{debugLog}</div>}
              </div>
              <div className="absolute bottom-0 left-0 right-0 p-8 bg-gradient-to-t from-slate-50 via-slate-50 to-transparent flex flex-col items-center">
                {(data.questionImageUrl || data.questionText) && status !== 'processing' && status !== 'ready' && ( <button onClick={handleProcessImage} className="group bg-slate-900 hover:bg-black text-white px-12 py-5 rounded-full font-black text-xl shadow-2xl flex items-center gap-4 active:scale-95 transition-all"><BrainCircuit className="text-indigo-400 group-hover:rotate-12 transition-transform" />Submit to Gemini 3.1</button> )}
                {!(data.questionImageUrl || data.questionText) && <div className="flex items-center gap-3 text-slate-400 animate-pulse font-bold text-[10px] uppercase tracking-[0.2em]"><Smartphone size={16} /> Awaiting Input</div>}
              </div>
            </div>
            
            <div className="w-1/2 bg-white flex flex-col overflow-y-auto">
              <div className="p-4 border-b sticky top-0 bg-white/90 backdrop-blur z-10 flex justify-between items-center px-8"><h3 className="text-sm font-bold uppercase tracking-widest text-slate-400 italic">Variations</h3><div className="bg-indigo-50 text-indigo-600 px-2 py-1 rounded text-[10px] font-black uppercase tracking-tighter">Gemini 3.1 Pro</div></div>
              <div className="p-8 space-y-4">
                {status === 'ready' ? (
                  data.variations.map((v, i) => (
                    <div key={i} className="border-2 border-slate-50 rounded-3xl overflow-hidden transition-all duration-300 hover:border-indigo-100">
                      <button onClick={() => toggleVariation(i)} className={`w-full p-6 flex justify-between items-center transition-colors ${expandedVariations[i] ? 'bg-indigo-600 text-white' : 'bg-slate-50 text-slate-600 hover:bg-slate-100'}`}><div className="flex items-center gap-3"><span className={`text-[10px] font-black px-2 py-0.5 rounded uppercase tracking-wider ${expandedVariations[i] ? 'bg-white text-indigo-600' : 'bg-indigo-600 text-white'}`}>{v.category}</span><span className="font-bold text-sm tracking-tight">Expand Variation</span></div>{expandedVariations[i] ? <ChevronUp size={18} /> : <ChevronDown size={18} />}</button>
                      {expandedVariations[i] && ( <div className="p-8 space-y-6 animate-in slide-in-from-top-2 duration-300"><div className="text-slate-700 leading-relaxed text-lg prose prose-indigo whitespace-pre-wrap"><Latex>{v.text}</Latex></div><button onClick={() => setShowSolutions(p => ({ ...p, [i]: !p[i] }))} className="flex items-center gap-2 text-sm font-bold text-indigo-600 bg-indigo-50 px-4 py-2 rounded-full hover:bg-indigo-100 active:scale-95 transition-all">{showSolutions[i] ? <EyeOff size={16} /> : <Eye size={16} />} {showSolutions[i] ? 'Hide Solution' : 'Show Solution'}</button>{showSolutions[i] && <div className="mt-4 p-8 bg-slate-50 rounded-3xl border border-slate-100 text-slate-600 shadow-inner animate-in zoom-in-95"><div className="font-bold text-xs uppercase text-slate-400 mb-4 tracking-widest text-center">Pedagogical Solution</div><div className="prose prose-slate max-w-none text-center whitespace-pre-wrap"><Latex>{v.solution}</Latex></div></div>}</div> )}
                    </div>
                  ))
                ) : ( <div className="space-y-6 text-center py-20">{[1,2,3].map(i => <div key={i} className="space-y-3 animate-pulse opacity-20"><div className="h-4 w-24 bg-slate-100 rounded mx-auto"></div><div className="h-20 w-full bg-slate-50 rounded-2xl"></div></div>)}<p className="text-[10px] font-black text-slate-200 uppercase tracking-widest mt-4">Awaiting AI Logic</p></div> )}
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
  canvas.width = pixelCrop.width * scaleX;
  canvas.height = pixelCrop.height * scaleY;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, pixelCrop.x * scaleX, pixelCrop.y * scaleY, pixelCrop.width * scaleX, pixelCrop.height * scaleY, 0, 0, canvas.width, canvas.height);
  return new Promise((res) => canvas.toBlob((b) => res(b!), 'image/jpeg', 1.0));
}

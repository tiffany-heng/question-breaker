'use client';

import { useState, useEffect, useRef } from 'react';
import { Camera, Columns2, Smartphone, ChevronRight, Eye, EyeOff, Loader2, CheckCircle2, X, Scissors, ArrowUpRight } from 'lucide-react';
import { supabase, SESSION_CHANNEL_PREFIX } from '@/lib/supabase';
import Latex from 'react-latex-next';
import ReactCrop, { type Crop, centerCrop, makeAspectCrop, PixelCrop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import 'katex/dist/katex.min.css';

// --- Types ---
type SessionStatus = 'idle' | 'waiting' | 'uploading' | 'cropping' | 'processing' | 'ready';

interface QuestionData {
  imageUrl: string | null;
  extractedText: string;
  variations: { category: string; text: string; solution: string; }[];
}

export default function QuestionBreaker() {
  const [sessionId, setSessionId] = useState<string>('');
  const [viewMode, setViewMode] = useState<'desktop' | 'mobile' | null>(null);
  const [status, setStatus] = useState<SessionStatus>('idle');
  const [aiStep, setAiStep] = useState<string>('idle');
  const [debugLog, setDebugLog] = useState<string>('');
  const [showSolutions, setShowSolutions] = useState<Record<number, boolean>>({});
  const channelRef = useRef<any>(null);
  
  const [data, setData] = useState<QuestionData>({ imageUrl: null, extractedText: '', variations: [] });

  // Cropping State (Free Form)
  const [imgSrc, setImgSrc] = useState('');
  const imgRef = useRef<HTMLImageElement>(null);
  const [crop, setCrop] = useState<Crop>();
  const [completedCrop, setCompletedCrop] = useState<PixelCrop>();
  const [rawFile, setRawFile] = useState<File | null>(null);

  useEffect(() => {
    return () => { if (channelRef.current) supabase.removeChannel(channelRef.current); };
  }, []);

  const subscribeToSession = (id: string, isHost: boolean) => {
    if (!supabase) return;
    const channel = supabase.channel(`${SESSION_CHANNEL_PREFIX}${id}`, { config: { broadcast: { self: true } } });
    channel
      .on('broadcast', { event: 'IMAGE_UPLOADED' }, ({ payload }: { payload: { imageUrl: string } }) => {
        setData(prev => ({ ...prev, imageUrl: payload.imageUrl }));
        if (isHost) handleProcessImage(payload.imageUrl);
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
    if (cleanId.length === 7) {
      setSessionId(cleanId);
      setViewMode('mobile');
      setStatus('waiting');
      subscribeToSession(cleanId, false);
    } else {
      alert("Please enter a 6-digit ID.");
    }
  };

  // --- Image Handling ---

  const onSelectFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      setRawFile(file);
      const reader = new FileReader();
      reader.addEventListener('load', () => {
        setImgSrc(reader.result?.toString() || '');
        setStatus('cropping');
      });
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
      canvas.width = completedCrop.width;
      canvas.height = completedCrop.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error("No context");

      ctx.drawImage(
        imgRef.current,
        completedCrop.x * scaleX,
        completedCrop.y * scaleY,
        completedCrop.width * scaleX,
        completedCrop.height * scaleY,
        0,
        0,
        completedCrop.width,
        completedCrop.height
      );

      canvas.toBlob(async (blob) => {
        if (!blob) return;
        const file = new File([blob], `crop-${Date.now()}.jpg`, { type: 'image/jpeg' });
        await uploadToSupabase(file);
      }, 'image/jpeg', 0.95);

    } catch (e: any) {
      alert("Crop failed: " + e.message);
      setStatus('waiting');
    }
  };

  const uploadToSupabase = async (file: File) => {
    try {
      const fileName = `${sessionId}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.]/g, '_')}`;
      const { error } = await supabase.storage.from('questions').upload(fileName, file);
      if (error) throw error;
      const { data: { publicUrl } } = supabase.storage.from('questions').getPublicUrl(fileName);
      channelRef.current.send({ type: 'broadcast', event: 'IMAGE_UPLOADED', payload: { imageUrl: publicUrl } });
      setStatus('processing');
      setImgSrc('');
    } catch (err: any) {
      alert('Upload failed: ' + err.message);
      setStatus('waiting');
    }
  };

  const handleProcessImage = async (url: string) => {
    setStatus('processing');
    setAiStep('AI Handshake...');
    try {
      const resp = await fetch('/api/process', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageUrl: url }) });
      const result = await resp.json();
      if (result.error) { setAiStep('Error: ' + result.error); if (result.raw) setDebugLog(result.raw); return; }
      setData(prev => ({ ...prev, extractedText: result.extractedText, variations: result.variations }));
      setStatus('ready');
      channelRef.current.send({ type: 'broadcast', event: 'VARIATIONS_READY', payload: result });
    } catch (err: any) {
      setAiStep('AI Failed');
      setTimeout(() => setStatus('waiting'), 3000);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col text-slate-900 font-sans">
      {/* 1. INITIAL VIEW */}
      {viewMode === null && (
        <div className="flex-1 flex flex-col items-center justify-center p-6">
          <div className="max-w-md w-full space-y-8 bg-white p-10 rounded-3xl shadow-xl border border-slate-100 text-center">
            <h1 className="text-4xl font-black text-indigo-600 italic">QB.</h1>
            <button onClick={startSession} className="mt-8 group flex items-center justify-between w-full p-6 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl transition-all shadow-lg">
              <div className="flex items-center gap-4 text-left"><Columns2 size={24} /><div className="font-bold text-lg italic-none not-italic">Host Session<div className="text-indigo-100 text-sm font-medium">On your laptop</div></div></div>
              <ChevronRight className="opacity-50" />
            </button>
            <div className="relative py-4 text-xs text-slate-400 uppercase tracking-widest flex items-center justify-center gap-4"><div className="h-px flex-1 bg-slate-100"></div>or<div className="h-px flex-1 bg-slate-100"></div></div>
            <div className="space-y-3">
              <input type="text" placeholder="Enter ID" className="w-full p-4 rounded-xl border-2 border-slate-100 text-center font-mono text-xl uppercase" onChange={(e) => setSessionId(e.target.value.toUpperCase())} value={sessionId} />
              <button onClick={() => joinSession(sessionId)} className="w-full p-5 bg-indigo-600 text-white rounded-2xl font-black shadow-xl">Join Session</button>
            </div>
          </div>
        </div>
      )}

      {/* 2. MOBILE VIEW */}
      {viewMode === 'mobile' && (
        <div className="flex-1 flex flex-col bg-white overflow-hidden">
          <header className="p-4 border-b flex justify-between items-center bg-slate-50/50"><strong>QB Mobile</strong><div className="px-3 py-1 bg-white border rounded-full text-xs font-mono font-bold text-slate-500 uppercase">ID: {sessionId}</div></header>
          
          <main className="flex-1 flex flex-col items-center justify-center p-8 space-y-8 text-center relative">
            {status === 'cropping' && imgSrc && (
              <div className="fixed inset-0 z-50 bg-slate-900 flex flex-col">
                <div className="p-4 flex justify-between items-center text-white border-b border-white/10">
                  <button onClick={() => setStatus('waiting')}><X /></button>
                  <span className="font-bold text-sm uppercase tracking-widest text-indigo-400">Drag corners to crop</span>
                  <button onClick={handleConfirmCrop} className="bg-indigo-600 px-4 py-2 rounded-lg font-black text-xs uppercase shadow-lg">Upload</button>
                </div>
                <div className="flex-1 overflow-auto bg-black flex items-center justify-center">
                  <ReactCrop crop={crop} onChange={c => setCrop(c)} onComplete={c => setCompletedCrop(c)}>
                    <img ref={imgRef} src={imgSrc} alt="Crop me" className="max-w-full" />
                  </ReactCrop>
                </div>
                <div className="p-6 bg-slate-900 grid grid-cols-2 gap-4">
                   <button onClick={() => uploadToSupabase(rawFile!)} className="col-span-2 text-slate-400 text-xs font-bold uppercase underline">Skip Crop & Upload Original</button>
                </div>
              </div>
            )}

            {status === 'processing' || status === 'uploading' ? (
              <div className="space-y-4"><Loader2 className="w-12 h-12 text-indigo-600 animate-spin mx-auto" /><p className="font-bold text-lg">{status === 'uploading' ? 'Uploading...' : 'AI Thinking...'}</p></div>
            ) : status === 'ready' ? (
              <div className="space-y-6 animate-in fade-in zoom-in duration-500"><div className="w-20 h-20 bg-green-50 text-green-600 rounded-full flex items-center justify-center mx-auto"><CheckCircle2 size={32} /></div><h2 className="text-2xl font-bold text-indigo-900 text-center">Variations Ready!</h2><button onClick={() => setStatus('waiting')} className="p-5 bg-indigo-600 text-white rounded-2xl font-black w-full">Upload Another</button></div>
            ) : (
              <div className="flex flex-col items-center gap-8">
                <div className="w-24 h-24 bg-indigo-50 rounded-full flex items-center justify-center text-indigo-600 shadow-inner"><Camera size={40} /></div>
                <div className="space-y-2"><h2 className="text-2xl font-bold tracking-tight text-indigo-900">Snap a Question</h2><p className="text-slate-500 text-sm">Take a photo of the problem you want to break.</p></div>
                <label className="flex items-center justify-center w-full gap-3 p-5 bg-indigo-600 text-white rounded-2xl font-black text-lg active:scale-95 cursor-pointer shadow-lg">
                  <Camera size={20} /> Open Camera
                  <input type="file" accept="image/*" capture="environment" className="hidden" onChange={onSelectFile} />
                </label>
              </div>
            )}
          </main>
        </div>
      )}

      {/* 3. DESKTOP VIEW */}
      {viewMode === 'desktop' && (
        <div className="flex-1 flex flex-col">
          <header className="h-16 border-b bg-white flex items-center justify-between px-8 shrink-0">
            <div className="flex items-center gap-3 font-black text-indigo-600 italic text-xl underline decoration-indigo-200 underline-offset-4">QB</div>
            <div className="flex items-center gap-4"><div className="px-4 py-1.5 bg-slate-100 rounded-full text-sm font-mono font-bold text-indigo-600">{sessionId}</div><button onClick={() => window.location.reload()} className="text-xs font-semibold text-slate-400">End Session</button></div>
          </header>
          
          <main className="flex-1 flex overflow-hidden">
            <div className="w-1/2 border-r bg-slate-50/50 flex flex-col relative">
              {data.imageUrl ? (<div className="flex-1 p-8"><img src={data.imageUrl} alt="Source" className="w-full h-full object-contain rounded-2xl shadow-2xl" /></div>) : (
                <div className="flex-1 flex items-center justify-center p-12 text-center max-w-xs mx-auto space-y-6">
                  <div className="w-20 h-20 bg-white rounded-3xl shadow-sm flex items-center justify-center mx-auto text-indigo-500"><Smartphone className="animate-bounce" /></div>
                  <div><h4 className="font-bold text-lg text-indigo-950">Connect Phone</h4><p className="text-slate-400 text-sm">Join <span className="underline font-bold text-indigo-600">{sessionId}</span> to upload.</p></div>
                </div>
              )}
              {status === 'processing' && (
                 <div className="absolute inset-0 bg-white/60 backdrop-blur-sm flex flex-col items-center justify-center z-20 space-y-4">
                    <Loader2 className="w-10 h-10 text-indigo-600 animate-spin" /><p className="font-bold text-indigo-950 uppercase tracking-tighter">AI Logic Engine Running</p>
                    <p className="text-[10px] uppercase font-bold text-slate-400 animate-pulse bg-white px-3 py-1 rounded-full shadow-sm">{aiStep}</p>
                    {debugLog && <div className="text-[8px] text-slate-300 max-w-[200px] truncate mt-4 border border-slate-100 p-1 rounded bg-white">Log: {debugLog}</div>}
                 </div>
              )}
            </div>
            
            <div className="w-1/2 bg-white flex flex-col overflow-y-auto">
              <div className="p-4 border-b sticky top-0 bg-white/90 backdrop-blur z-10 flex justify-between items-center px-8">
                <h3 className="text-sm font-bold uppercase tracking-widest text-slate-400">Variations</h3>
                <div className="bg-indigo-50 text-indigo-600 px-2 py-1 rounded text-[10px] font-bold uppercase">Gemini 3.1</div>
              </div>
              <div className="p-8 space-y-12">
                {status === 'ready' ? (
                  <div className="space-y-10 pb-20">
                    {data.variations.map((v, i) => (
                      <div key={i} className="group space-y-4 animate-in fade-in slide-in-from-right-4 duration-500" style={{ animationDelay: `${i*150}ms` }}>
                        <div className="flex items-center gap-2"><span className="text-[10px] font-black bg-indigo-600 text-white px-2 py-0.5 rounded uppercase tracking-wider">{v.category}</span><div className="h-px flex-1 bg-slate-100"></div></div>
                        <div className="text-slate-700 leading-relaxed text-lg prose prose-indigo"><Latex>{v.text}</Latex></div>
                        <button onClick={() => setShowSolutions(p => ({ ...p, [i]: !p[i] }))} className="flex items-center gap-2 text-sm font-bold text-indigo-600 bg-indigo-50 px-4 py-2 rounded-full">{showSolutions[i] ? <EyeOff size={16} /> : <Eye size={16} />} {showSolutions[i] ? 'Hide Solution' : 'Show Solution'}</button>
                        {showSolutions[i] && <div className="mt-4 p-8 bg-slate-50 rounded-3xl border border-slate-100 text-slate-600 shadow-inner animate-in zoom-in-95"><div className="font-bold text-xs uppercase text-slate-400 mb-4 tracking-widest">Pedagogical Solution</div><div className="prose prose-slate max-w-none"><Latex>{v.solution}</Latex></div></div>}
                      </div>
                    ))}
                  </div>
                ) : (status === 'waiting' && !data.imageUrl) ? (
                  <div className="flex flex-col items-center justify-center h-64 text-slate-100 font-black uppercase text-center tracking-widest opacity-20"><Columns2 size={80} />Waiting</div>
                ) : <div className="space-y-6">{[1,2,3].map(i => <div key={i} className="space-y-3 animate-pulse"><div className="h-4 w-24 bg-slate-100 rounded"></div><div className="h-20 w-full bg-slate-50 rounded-2xl"></div></div>)}</div>}
              </div>
            </div>
          </main>
        </div>
      )}
    </div>
  );
}

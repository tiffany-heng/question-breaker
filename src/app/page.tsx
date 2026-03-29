'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Camera, Columns2, Smartphone, ChevronRight, Eye, EyeOff, Loader2, CheckCircle2, X, Scissors, ArrowUpRight } from 'lucide-react';
import { supabase, SESSION_CHANNEL_PREFIX } from '@/lib/supabase';
import Latex from 'react-latex-next';
import Cropper from 'react-easy-crop';
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

  // Cropping State
  const [tempImage, setTempImage] = useState<string | null>(null);
  const [rawFile, setRawFile] = useState<File | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<any>(null);

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

  const onSelectFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      setRawFile(file);
      const reader = new FileReader();
      reader.addEventListener('load', () => {
        setTempImage(reader.result as string);
        setStatus('cropping');
      });
      reader.readAsDataURL(file);
    }
  };

  const onCropComplete = useCallback((_a: any, pixels: any) => { setCroppedAreaPixels(pixels); }, []);

  const handleConfirmCrop = async () => {
    if (!tempImage || !croppedAreaPixels) return;
    setStatus('uploading');
    try {
      const croppedBlob = await getCroppedImg(tempImage, croppedAreaPixels);
      const file = new File([croppedBlob], "cropped.jpg", { type: 'image/jpeg' });
      await uploadToSupabase(file);
    } catch (e: any) {
      alert("Crop failed: " + e.message);
      setStatus('waiting');
    }
  };

  const handleSkipCrop = async () => {
    if (!rawFile) return;
    setStatus('uploading');
    await uploadToSupabase(rawFile);
  };

  const uploadToSupabase = async (file: File) => {
    try {
      const fileName = `${sessionId}/${Date.now()}-${file.name}`;
      const { error } = await supabase.storage.from('questions').upload(fileName, file);
      if (error) throw error;
      const { data: { publicUrl } } = supabase.storage.from('questions').getPublicUrl(fileName);
      channelRef.current.send({ type: 'broadcast', event: 'IMAGE_UPLOADED', payload: { imageUrl: publicUrl } });
      setStatus('processing');
      setTempImage(null);
    } catch (err: any) {
      alert('Upload failed: ' + err.message);
      setStatus('waiting');
    }
  };

  const handleProcessImage = async (url: string) => {
    setStatus('processing');
    setAiStep('Thinking...');
    try {
      const resp = await fetch('/api/process', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageUrl: url }) });
      const result = await resp.json();
      if (result.error) { setAiStep('Error: ' + result.error); if (result.raw) setDebugLog(result.raw); return; }
      setData(prev => ({ ...prev, extractedText: result.extractedText, variations: result.variations }));
      setStatus('ready');
      channelRef.current.send({ type: 'broadcast', event: 'VARIATIONS_READY', payload: result });
    } catch (err: any) {
      setAiStep('Failed');
      setTimeout(() => setStatus('waiting'), 3000);
    }
  };

  const toggleSolution = (i: number) => setShowSolutions(p => ({ ...p, [i]: !p[i] }));

  // --- Views ---

  if (viewMode === null) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 text-slate-900 font-sans">
        <div className="max-w-md w-full space-y-8 bg-white p-10 rounded-3xl shadow-xl border border-slate-100 text-center text-indigo-600 font-black italic text-4xl">QB.
          <button onClick={startSession} className="mt-8 group flex items-center justify-between w-full p-6 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl transition-all shadow-lg shadow-indigo-200">
            <div className="flex items-center gap-4 text-left"><Columns2 size={24} /><div className="font-bold text-lg italic-none not-italic">Host Session<div className="text-indigo-100 text-sm font-medium">On your laptop</div></div></div>
            <ChevronRight className="opacity-50" />
          </button>
          <div className="relative py-4 italic-none not-italic font-normal text-xs text-slate-400 uppercase tracking-widest flex items-center justify-center gap-4"><div className="h-px flex-1 bg-slate-100"></div>or<div className="h-px flex-1 bg-slate-100"></div></div>
          <div className="space-y-3 italic-none not-italic">
            <input type="text" placeholder="Enter ID" className="w-full p-4 rounded-xl border-2 border-slate-100 text-center font-mono text-xl uppercase" onChange={(e) => setSessionId(e.target.value.toUpperCase())} value={sessionId} />
            <button onClick={() => joinSession(sessionId)} className="w-full p-5 bg-indigo-600 text-white rounded-2xl font-black shadow-xl shadow-indigo-100">Join Session</button>
          </div>
        </div>
      </div>
    );
  }

  if (viewMode === 'mobile') {
    return (
      <div className="min-h-screen bg-white flex flex-col text-slate-900 font-sans">
        <header className="p-4 border-b flex justify-between items-center bg-slate-50/50"><strong>QB Mobile</strong><div className="px-3 py-1 bg-white border rounded-full text-xs font-mono font-bold text-slate-500">ID: {sessionId}</div></header>
        <main className="flex-1 flex flex-col items-center justify-center p-8 space-y-8 text-center relative">
          {status === 'cropping' && tempImage && (
            <div className="fixed inset-0 z-50 bg-black flex flex-col">
              <div className="flex-1 relative bg-black h-full w-full overflow-hidden">
                <Cropper image={tempImage} crop={crop} zoom={zoom} aspect={undefined} onCropChange={setCrop} onCropComplete={onCropComplete} onZoomChange={setZoom} />
              </div>
              <div className="p-4 bg-slate-900 grid grid-cols-2 gap-3">
                <button onClick={() => setStatus('waiting')} className="text-white p-4 font-bold border border-white/20 rounded-xl">Cancel</button>
                <button onClick={handleSkipCrop} className="text-indigo-300 p-4 font-bold border border-indigo-500/30 rounded-xl flex items-center justify-center gap-2">Skip Crop <ArrowUpRight size={16}/></button>
                <button onClick={handleConfirmCrop} className="col-span-2 bg-indigo-600 text-white p-5 rounded-xl flex items-center justify-center gap-2 font-black shadow-lg"><Scissors size={20} /> Crop & Upload</button>
              </div>
            </div>
          )}
          {status === 'processing' || status === 'uploading' ? (
            <div className="space-y-4"><Loader2 className="w-12 h-12 text-indigo-600 animate-spin mx-auto" /><p className="font-bold text-lg">{status === 'uploading' ? 'Uploading...' : 'AI Thinking...'}</p></div>
          ) : status === 'ready' ? (
            <div className="space-y-6"><div className="w-20 h-20 bg-green-50 text-green-600 rounded-full flex items-center justify-center mx-auto"><CheckCircle2 size={32} /></div><h2 className="text-2xl font-bold">Variations Ready!</h2><button onClick={() => setStatus('waiting')} className="p-4 bg-indigo-600 text-white rounded-2xl font-bold w-full">Upload Another</button></div>
          ) : (
            <>
              <div className="w-24 h-24 bg-indigo-50 rounded-full flex items-center justify-center text-indigo-600"><Camera size={40} /></div>
              <div className="space-y-2"><h2 className="text-2xl font-bold">Snap a Question</h2><p className="text-slate-500 text-sm">Take a clear photo of the problem.</p></div>
              <label className="flex items-center justify-center w-full gap-3 p-5 bg-indigo-600 text-white rounded-2xl font-black text-lg active:scale-95 cursor-pointer shadow-lg"><Camera size={20} />Open Camera<input type="file" accept="image/*" capture="environment" className="hidden" onChange={onSelectFile} /></label>
            </>
          )}
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col text-slate-900 font-sans pb-10">
      <header className="h-16 border-b bg-white flex items-center justify-between px-8 shrink-0">
        <div className="flex items-center gap-3"><div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white font-black text-xs italic">QB</div><span className="font-bold text-lg tracking-tight">Question Breaker</span></div>
        <div className="flex items-center gap-4"><div className="px-4 py-1.5 bg-slate-100 rounded-full text-sm font-mono font-bold text-indigo-600 uppercase tracking-widest">{sessionId}</div><button onClick={() => window.location.reload()} className="text-xs font-semibold text-slate-400">End Session</button></div>
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
                <Loader2 className="w-10 h-10 text-indigo-600 animate-spin" /><p className="font-bold text-indigo-950">Gemini is analyzing...</p>
                <p className="text-[10px] uppercase font-bold text-slate-400 animate-pulse bg-white px-3 py-1 rounded-full shadow-sm">{aiStep}</p>
                {debugLog && <div className="text-[8px] text-slate-300 max-w-[200px] truncate mt-4 border border-slate-100 p-1 rounded bg-white">Log: {debugLog}</div>}
             </div>
          )}
        </div>
        <div className="w-1/2 bg-white flex flex-col overflow-y-auto">
          <div className="p-4 border-b sticky top-0 bg-white/90 backdrop-blur z-10 flex justify-between items-center px-8">
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-400">Logic Variations</h3>
            <div className="bg-indigo-50 text-indigo-600 px-2 py-1 rounded text-[10px] font-bold uppercase tracking-tighter shadow-sm">Gemini 3.1 Pro</div>
          </div>
          <div className="p-8 space-y-12">
            {status === 'ready' ? (
              <div className="space-y-10 pb-20">
                {data.variations.map((v, i) => (
                  <div key={i} className="group space-y-4 animate-in fade-in slide-in-from-right-4 duration-500" style={{ animationDelay: `${i*150}ms` }}>
                    <div className="flex items-center gap-2"><span className="text-[10px] font-black bg-indigo-600 text-white px-2 py-0.5 rounded uppercase tracking-wider">{v.category}</span><div className="h-px flex-1 bg-slate-100"></div></div>
                    <div className="text-slate-700 leading-relaxed text-lg prose prose-indigo"><Latex>{v.text}</Latex></div>
                    <button onClick={() => toggleSolution(i)} className="flex items-center gap-2 text-sm font-bold text-indigo-600 bg-indigo-50 px-4 py-2 rounded-full hover:bg-indigo-100 active:scale-95 transition-all">{showSolutions[i] ? <EyeOff size={16} /> : <Eye size={16} />}{showSolutions[i] ? 'Hide Solution' : 'Show Solution'}</button>
                    {showSolutions[i] && <div className="mt-4 p-8 bg-slate-50 rounded-3xl border border-slate-100 text-slate-600 shadow-inner animate-in zoom-in-95"><div className="font-bold text-xs uppercase text-slate-400 mb-4 tracking-widest">Pedagogical Solution</div><div className="prose prose-slate max-w-none"><Latex>{v.solution}</Latex></div></div>}
                  </div>
                ))}
              </div>
            ) : (status === 'waiting' && !data.imageUrl) ? (
              <div className="flex flex-col items-center justify-center h-64 text-slate-100"><Columns2 size={80} className="mb-4" /><p className="text-sm font-black uppercase tracking-[0.3em] text-slate-200">Waiting for Upload</p></div>
            ) : <div className="space-y-6">{[1,2,3].map(i => <div key={i} className="space-y-3 animate-pulse"><div className="h-4 w-24 bg-slate-100 rounded"></div><div className="h-20 w-full bg-slate-50 rounded-2xl"></div></div>)}</div>}
          </div>
        </div>
      </main>
    </div>
  );
}

// Helper: Improved getCroppedImg
async function getCroppedImg(imageSrc: string, pixelCrop: any): Promise<Blob> {
  const image = await new Promise<HTMLImageElement>((res, rej) => {
    const img = new Image();
    img.src = imageSrc;
    img.onload = () => res(img);
    img.onerror = rej;
  });
  const canvas = document.createElement('canvas');
  canvas.width = pixelCrop.width;
  canvas.height = pixelCrop.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error("No context");
  ctx.drawImage(image, pixelCrop.x, pixelCrop.y, pixelCrop.width, pixelCrop.height, 0, 0, pixelCrop.width, pixelCrop.height);
  return new Promise((res) => { canvas.toBlob((b) => { if (b) res(b); }, 'image/jpeg', 0.95); });
}

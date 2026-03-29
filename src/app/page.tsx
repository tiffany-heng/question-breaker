'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Camera, Columns2, Smartphone, ChevronRight, Eye, EyeOff, Loader2, CheckCircle2, X, Scissors, ArrowUpRight, MessageSquareText, Image as ImageIcon, ClipboardPaste } from 'lucide-react';
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
  solutionImageUrl: string | null;
  extractedText: string;
  userSolutionText: string;
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
  
  const [data, setData] = useState<QuestionData>({ 
    questionImageUrl: null, 
    solutionImageUrl: null, 
    extractedText: '', 
    userSolutionText: '', 
    variations: [] 
  });

  // Cropping & Multi-Upload State
  const [activeUploadType, setActiveUploadType] = useState<ImageType>('question');
  const [imgSrc, setImgSrc] = useState('');
  const [userSolutionInput, setUserSolutionInput] = useState('');
  const imgRef = useRef<HTMLImageElement>(null);
  const [crop, setCrop] = useState<Crop>();
  const [completedCrop, setCompletedCrop] = useState<PixelCrop>();
  const [rawFile, setRawFile] = useState<File | null>(null);

  useEffect(() => {
    return () => { if (channelRef.current) supabase.removeChannel(channelRef.current); };
  }, []);

  // --- Laptop Paste Listener ---
  useEffect(() => {
    if (viewMode !== 'desktop') return;

    const handlePaste = async (e: ClipboardEvent) => {
      const item = e.clipboardData?.items[0];
      if (item?.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          const type = window.confirm("Paste as Question? (Cancel for Solution)") ? 'question' : 'solution';
          setStatus('uploading');
          await uploadToSupabase(file, type);
        }
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [viewMode, sessionId]);

  const subscribeToSession = (id: string, isHost: boolean) => {
    if (!supabase) return;
    const channel = supabase.channel(`${SESSION_CHANNEL_PREFIX}${id}`, { config: { broadcast: { self: true } } });
    channel
      .on('broadcast', { event: 'IMAGE_UPLOADED' }, ({ payload }: { payload: { imageUrl: string, type: ImageType, userSolutionText?: string } }) => {
        setData(prev => {
          const newData = { ...prev };
          if (payload.type === 'question') newData.questionImageUrl = payload.imageUrl;
          if (payload.type === 'solution') newData.solutionImageUrl = payload.imageUrl;
          if (payload.userSolutionText) newData.userSolutionText = payload.userSolutionText;
          
          // Only host triggers AI, and only if we have a question
          if (isHost && newData.questionImageUrl) {
             handleProcessImage(newData.questionImageUrl, newData.solutionImageUrl, newData.userSolutionText);
          }
          return newData;
        });
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

  const onSelectFile = (e: React.ChangeEvent<HTMLInputElement>, type: ImageType) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      setRawFile(file);
      setActiveUploadType(type);
      const reader = new FileReader();
      reader.onload = () => {
        setImgSrc(reader.result?.toString() || '');
        setStatus('cropping');
      };
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
    } catch (e: any) {
      alert("Crop failed: " + e.message);
      setStatus('waiting');
    }
  };

  const uploadToSupabase = async (file: File, type: ImageType) => {
    try {
      const fileName = `${sessionId}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.]/g, '_')}`;
      const { error } = await supabase.storage.from('questions').upload(fileName, file);
      if (error) throw error;
      const { data: { publicUrl } } = supabase.storage.from('questions').getPublicUrl(fileName);
      
      channelRef.current.send({
        type: 'broadcast',
        event: 'IMAGE_UPLOADED',
        payload: { imageUrl: publicUrl, type, userSolutionText: userSolutionInput }
      });
      
      setStatus(type === 'question' ? 'processing' : 'waiting');
      setImgSrc('');
    } catch (err: any) {
      alert('Upload failed: ' + err.message);
      setStatus('waiting');
    }
  };

  const handleProcessImage = async (qUrl: string, sUrl: string | null, sText: string) => {
    setStatus('processing');
    setAiStep('AI Handshake...');
    try {
      const resp = await fetch('/api/process', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ questionImageUrl: qUrl, solutionImageUrl: sUrl, userSolutionText: sText }) 
      });
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
      {/* INITIAL VIEW */}
      {viewMode === null && (
        <div className="flex-1 flex flex-col items-center justify-center p-6">
          <div className="max-w-md w-full space-y-8 bg-white p-10 rounded-3xl shadow-xl border border-slate-100 text-center">
            <h1 className="text-4xl font-black text-indigo-600 italic underline decoration-indigo-100 decoration-8 underline-offset-[-2px]">QB.</h1>
            <button onClick={startSession} className="mt-8 group flex items-center justify-between w-full p-6 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl transition-all shadow-lg shadow-indigo-200">
              <div className="flex items-center gap-4 text-left"><Columns2 size={24} /><div className="font-bold text-lg">Host Session<div className="text-indigo-100 text-sm font-medium">On your laptop</div></div></div>
              <ChevronRight className="opacity-50" />
            </button>
            <div className="relative py-2 text-xs text-slate-400 uppercase tracking-widest flex items-center justify-center gap-4"><div className="h-px flex-1 bg-slate-100"></div>or<div className="h-px flex-1 bg-slate-100"></div></div>
            <div className="space-y-3">
              <input type="text" placeholder="Enter 6-digit ID" className="w-full p-4 rounded-xl border-2 border-slate-100 text-center font-mono text-xl uppercase tracking-widest focus:border-indigo-500 outline-none transition-colors" onChange={(e) => setSessionId(e.target.value.toUpperCase())} value={sessionId} />
              <button onClick={() => joinSession(sessionId)} className="w-full p-5 bg-indigo-600 text-white rounded-2xl font-black shadow-xl shadow-indigo-100 active:scale-95 transition-transform">Join Session</button>
            </div>
          </div>
        </div>
      )}

      {/* MOBILE VIEW */}
      {viewMode === 'mobile' && (
        <div className="flex-1 flex flex-col bg-white overflow-hidden pb-10">
          <header className="p-4 border-b flex justify-between items-center bg-slate-50/50"><strong>QB Mobile</strong><div className="px-3 py-1 bg-white border rounded-full text-xs font-mono font-bold text-slate-500">ID: {sessionId}</div></header>
          
          <main className="flex-1 flex flex-col p-6 space-y-6 text-center relative overflow-y-auto">
            {status === 'cropping' && imgSrc && (
              <div className="fixed inset-0 z-50 bg-slate-900 flex flex-col">
                <div className="p-4 flex justify-between items-center text-white border-b border-white/10 bg-slate-950">
                  <button onClick={() => setStatus('waiting')} className="p-2"><X /></button>
                  <span className="font-bold text-xs uppercase tracking-widest text-indigo-400">Crop {activeUploadType}</span>
                  <button onClick={handleConfirmCrop} className="bg-indigo-600 px-6 py-2 rounded-full font-black text-xs uppercase shadow-lg">Confirm</button>
                </div>
                <div className="flex-1 overflow-auto bg-black flex items-center justify-center p-4">
                  <ReactCrop crop={crop} onChange={c => setCrop(c)} onComplete={c => setCompletedCrop(c)} className="max-h-full">
                    <img ref={imgRef} src={imgSrc} alt="Crop" className="max-w-full max-h-[60vh] object-contain" />
                  </ReactCrop>
                </div>
                <div className="p-4 bg-slate-950 space-y-3">
                  {activeUploadType === 'question' && (
                    <textarea 
                      placeholder="Paste solution text here (optional)..." 
                      value={userSolutionInput}
                      onChange={(e) => setUserSolutionInput(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white text-sm focus:border-indigo-500 outline-none h-20 resize-none"
                    />
                  )}
                  <button onClick={() => uploadToSupabase(rawFile!, activeUploadType)} className="w-full p-3 bg-white/5 text-slate-400 text-[10px] font-black uppercase tracking-widest rounded-xl border border-white/10">Skip Crop & Upload</button>
                </div>
              </div>
            )}

            {status === 'processing' || status === 'uploading' ? (
              <div className="flex-1 flex flex-col items-center justify-center space-y-4">
                <Loader2 className="w-12 h-12 text-indigo-600 animate-spin mx-auto" />
                <p className="font-bold text-lg text-indigo-900">{status === 'uploading' ? 'Syncing image...' : 'AI is Thinking...'}</p>
              </div>
            ) : status === 'ready' ? (
              <div className="flex-1 flex flex-col items-center justify-center space-y-6 animate-in fade-in zoom-in duration-500">
                <div className="w-20 h-20 bg-green-50 text-green-600 rounded-full flex items-center justify-center mx-auto"><CheckCircle2 size={32} /></div>
                <h2 className="text-2xl font-bold text-indigo-900">Variations Ready!</h2>
                <button onClick={() => { setStatus('waiting'); setUserSolutionInput(''); }} className="p-5 bg-indigo-600 text-white rounded-2xl font-black w-full shadow-lg">Upload Another</button>
              </div>
            ) : (
              <div className="flex-1 flex flex-col justify-center gap-6">
                {/* QUESTION UPLOAD */}
                <div className="space-y-4 p-6 bg-slate-50 rounded-3xl border border-slate-100">
                  <div className="text-sm font-black text-indigo-600 uppercase tracking-widest">Step 1: The Question</div>
                  <label className="flex items-center justify-center w-full gap-3 p-5 bg-indigo-600 text-white rounded-2xl font-black text-lg active:scale-95 cursor-pointer shadow-lg">
                    <Camera size={20} /> Snap Question
                    <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => onSelectFile(e, 'question')} />
                  </label>
                </div>

                <div className="h-px bg-slate-100 mx-10"></div>

                {/* SOLUTION UPLOAD */}
                <div className="space-y-4 p-6 bg-white border border-slate-100 rounded-3xl shadow-sm">
                  <div className="text-sm font-black text-slate-400 uppercase tracking-widest">Step 2: The Solution (Optional)</div>
                  <label className="flex items-center justify-center w-full gap-3 p-5 bg-white border-2 border-slate-100 text-slate-600 rounded-2xl font-black text-lg active:scale-95 cursor-pointer">
                    <ImageIcon size={20} /> Add Answer Key
                    <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => onSelectFile(e, 'solution')} />
                  </label>
                </div>
              </div>
            )}
          </main>
        </div>
      )}

      {/* DESKTOP VIEW */}
      {viewMode === 'desktop' && (
        <div className="flex-1 flex flex-col">
          <header className="h-16 border-b bg-white flex items-center justify-between px-8 shrink-0">
            <div className="flex items-center gap-3 font-black text-indigo-600 italic text-xl">QB</div>
            <div className="flex items-center gap-4"><div className="px-4 py-1.5 bg-slate-100 rounded-full text-sm font-mono font-bold text-indigo-600 uppercase tracking-widest">{sessionId}</div><button onClick={() => window.location.reload()} className="text-xs font-semibold text-slate-400">End Session</button></div>
          </header>
          
          <main className="flex-1 flex overflow-hidden">
            <div className="w-1/2 border-r bg-slate-50/50 flex flex-col relative">
              <div className="flex-1 overflow-y-auto p-8 space-y-8">
                {/* QUESTION DISPLAY */}
                <div className="space-y-3">
                  <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-indigo-500"></div> The Question
                  </h4>
                  {data.questionImageUrl ? (
                    <img src={data.questionImageUrl} alt="Question" className="w-full rounded-2xl shadow-2xl border border-white" />
                  ) : (
                    <div className="aspect-video bg-white/50 rounded-2xl border-2 border-dashed border-slate-200 flex flex-col items-center justify-center text-slate-300 space-y-2">
                      <ClipboardPaste size={32} className="opacity-20" />
                      <span className="text-xs font-bold uppercase tracking-widest">Paste or Upload Image</span>
                    </div>
                  )}
                </div>

                {/* SOLUTION DISPLAY */}
                {(data.solutionImageUrl || data.userSolutionText) && (
                  <div className="space-y-3 animate-in slide-in-from-bottom-4 duration-500">
                    <h4 className="text-[10px] font-black text-indigo-400 uppercase tracking-[0.2em] flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-indigo-400"></div> Answer Key Reference
                    </h4>
                    {data.solutionImageUrl && <img src={data.solutionImageUrl} alt="Solution" className="w-full rounded-2xl shadow-lg border border-white opacity-80" />}
                    {data.userSolutionText && <div className="bg-indigo-600 text-white p-6 rounded-2xl text-sm font-medium shadow-xl">{data.userSolutionText}</div>}
                  </div>
                )}
              </div>

              {!data.questionImageUrl && (
                <div className="absolute inset-0 flex items-center justify-center p-12 text-center pointer-events-none">
                  <div className="space-y-4 max-w-xs">
                    <Smartphone className="animate-bounce mx-auto text-indigo-500" />
                    <p className="text-slate-400 text-sm">Join <span className="underline font-bold text-indigo-600">{sessionId}</span> or paste an image here.</p>
                  </div>
                </div>
              )}

              {status === 'processing' && (
                 <div className="absolute inset-0 bg-white/80 backdrop-blur-sm flex flex-col items-center justify-center z-20 space-y-4">
                    <Loader2 className="w-10 h-10 text-indigo-600 animate-spin" />
                    <p className="font-bold text-indigo-950 uppercase tracking-widest text-xs">AI Logic Engine Active</p>
                    <p className="text-[10px] uppercase font-bold text-slate-400 animate-pulse bg-white px-3 py-1 rounded-full shadow-sm">{aiStep}</p>
                 </div>
              )}
            </div>
            
            <div className="w-1/2 bg-white flex flex-col overflow-y-auto">
              <div className="p-4 border-b sticky top-0 bg-white/90 backdrop-blur z-10 flex justify-between items-center px-8">
                <h3 className="text-sm font-bold uppercase tracking-widest text-slate-400 italic">Variations</h3>
                <div className="bg-indigo-50 text-indigo-600 px-2 py-1 rounded text-[10px] font-black uppercase tracking-tighter">Gemini 3.1 Pro</div>
              </div>
              <div className="p-8 space-y-12">
                {status === 'ready' ? (
                  <div className="space-y-10 pb-20">
                    {data.variations.map((v, i) => (
                      <div key={i} className="group space-y-4 animate-in fade-in slide-in-from-right-4 duration-500" style={{ animationDelay: `${i*150}ms` }}>
                        <div className="flex items-center gap-2"><span className="text-[10px] font-black bg-indigo-600 text-white px-2 py-0.5 rounded uppercase tracking-wider">{v.category}</span><div className="h-px flex-1 bg-slate-100"></div></div>
                        <div className="text-slate-700 leading-relaxed text-lg prose prose-indigo"><Latex>{v.text}</Latex></div>
                        <button onClick={() => setShowSolutions(p => ({ ...p, [i]: !p[i] }))} className="flex items-center gap-2 text-sm font-bold text-indigo-600 bg-indigo-50 px-4 py-2 rounded-full hover:bg-indigo-100 active:scale-95 transition-all">{showSolutions[i] ? <EyeOff size={16} /> : <Eye size={16} />} {showSolutions[i] ? 'Hide Solution' : 'Show Solution'}</button>
                        {showSolutions[i] && <div className="mt-4 p-8 bg-slate-50 rounded-3xl border border-slate-100 text-slate-600 shadow-inner animate-in zoom-in-95"><div className="font-bold text-xs uppercase text-slate-400 mb-4 tracking-widest">Pedagogical Solution</div><div className="prose prose-slate max-w-none"><Latex>{v.solution}</Latex></div></div>}
                      </div>
                    ))}
                  </div>
                ) : <div className="space-y-6">{[1,2,3].map(i => <div key={i} className="space-y-3 animate-pulse"><div className="h-4 w-24 bg-slate-100 rounded"></div><div className="h-20 w-full bg-slate-50 rounded-2xl"></div></div>)}</div>}
              </div>
            </div>
          </main>
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

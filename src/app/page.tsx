'use client';

import { useState, useEffect, useRef } from 'react';
import { Camera, Columns2, Smartphone, ChevronRight, Eye, EyeOff, Loader2, CheckCircle2 } from 'lucide-react';
import { supabase, SESSION_CHANNEL_PREFIX } from '@/lib/supabase';
import Latex from 'react-latex-next';
import 'katex/dist/katex.min.css';

// --- Types ---
type SessionStatus = 'idle' | 'waiting' | 'uploading' | 'processing' | 'ready';

interface QuestionData {
  imageUrl: string | null;
  extractedText: string;
  variations: {
    category: string;
    text: string;
    solution: string;
  }[];
}

export default function QuestionBreaker() {
  // --- State ---
  const [sessionId, setSessionId] = useState<string>('');
  const [viewMode, setViewMode] = useState<'desktop' | 'mobile' | null>(null);
  const [status, setStatus] = useState<SessionStatus>('idle');
  const [aiStep, setAiStep] = useState<string>('idle');
  const [showSolutions, setShowSolutions] = useState<Record<number, boolean>>({});
  const channelRef = useRef<any>(null);
  
  const [data, setData] = useState<QuestionData>({
    imageUrl: null,
    extractedText: '',
    variations: []
  });

  // --- Real-time Logic ---

  useEffect(() => {
    return () => {
      if (channelRef.current) supabase.removeChannel(channelRef.current);
    };
  }, []);

  const subscribeToSession = (id: string, isHost: boolean) => {
    if (!supabase) return;

    const channel = supabase.channel(`${SESSION_CHANNEL_PREFIX}${id}`, {
      config: { broadcast: { self: true } }
    });

    channel
      .on('broadcast', { event: 'IMAGE_UPLOADED' }, ({ payload }: { payload: { imageUrl: string } }) => {
        setData(prev => ({ ...prev, imageUrl: payload.imageUrl }));
        if (isHost) handleProcessImage(payload.imageUrl);
      })
      .on('broadcast', { event: 'VARIATIONS_READY' }, ({ payload }: { payload: any }) => {
        setData(prev => ({ ...prev, extractedText: payload.extractedText, variations: payload.variations }));
        setStatus('ready');
      })
      .subscribe((status: string) => {
        if (status === 'SUBSCRIBED') {
          if (!isHost) channel.send({ type: 'broadcast', event: 'USER_JOINED', payload: { device: 'mobile' } });
        }
      });

    channelRef.current = channel;
  };

  const generateId = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const p1 = Array.from({ length: 3 }, () => chars.charAt(Math.floor(Math.random() * chars.length))).join('');
    const p2 = Array.from({ length: 3 }, () => chars.charAt(Math.floor(Math.random() * chars.length))).join('');
    return `${p1}-${p2}`;
  };

  const startSession = () => {
    const newId = generateId();
    setSessionId(newId);
    setViewMode('desktop');
    setStatus('waiting');
    subscribeToSession(newId, true);
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
      alert("Please enter a 6-digit session ID.");
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !sessionId) return;
    setStatus('uploading');
    try {
      const fileName = `${sessionId}/${Date.now()}-${file.name}`;
      const { error } = await supabase.storage.from('questions').upload(fileName, file);
      if (error) throw error;
      const { data: { publicUrl } } = supabase.storage.from('questions').getPublicUrl(fileName);
      channelRef.current.send({ type: 'broadcast', event: 'IMAGE_UPLOADED', payload: { imageUrl: publicUrl } });
      setStatus('processing');
    } catch (err: any) {
      alert('Upload failed: ' + err.message);
      setStatus('waiting');
    }
  };

  const handleProcessImage = async (url: string) => {
    setStatus('processing');
    setAiStep('Handshake: Starting...');
    try {
      const resp = await fetch('/api/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: url })
      });
      setAiStep('Handshake: API Connected');
      const result = await resp.json();
      if (result.error) {
         setAiStep('Error: ' + result.error);
         return;
      }
      setAiStep('Handshake: Variations Received');
      
      // Update Laptop Locally
      setData(prev => ({ ...prev, extractedText: result.extractedText, variations: result.variations }));
      setStatus('ready');

      // Broadcast to Phone
      channelRef.current.send({ type: 'broadcast', event: 'VARIATIONS_READY', payload: result });
    } catch (err: any) {
      setAiStep('Handshake: Failed - ' + err.message);
      setStatus('waiting');
    }
  };

  const toggleSolution = (i: number) => setShowSolutions(p => ({ ...p, [i]: !p[i] }));

  // --- UI Views ---

  if (viewMode === null) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 text-slate-900 font-sans">
        <div className="max-w-md w-full space-y-8 bg-white p-10 rounded-3xl shadow-xl border border-slate-100 text-center">
          <h1 className="text-4xl font-black text-indigo-600 italic">QB.</h1>
          <button onClick={startSession} className="group flex items-center justify-between w-full p-6 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl transition-all shadow-lg shadow-indigo-200">
            <div className="flex items-center gap-4"><Columns2 size={24} /><div className="text-left"><div className="font-bold text-lg">Host Session</div><div className="text-indigo-100 text-sm">On your laptop</div></div></div>
            <ChevronRight className="opacity-50 group-hover:translate-x-1" />
          </button>
          <div className="relative py-2"><div className="absolute inset-0 flex items-center"><span className="w-full border-t border-slate-100"></span></div><div className="relative flex justify-center text-xs uppercase"><span className="bg-white px-2 text-slate-400">or</span></div></div>
          <div className="space-y-3">
            <input type="text" placeholder="Enter ID (e.g. XJ3-921)" className="w-full p-4 rounded-xl border-2 border-slate-100 text-center font-mono text-xl uppercase" onChange={(e) => setSessionId(e.target.value.toUpperCase())} value={sessionId} />
            <button onClick={() => joinSession(sessionId)} className="w-full p-5 bg-indigo-600 text-white rounded-2xl font-black active:scale-95 shadow-xl shadow-indigo-100">Join Session</button>
          </div>
        </div>
      </div>
    );
  }

  if (viewMode === 'mobile') {
    return (
      <div className="min-h-screen bg-white flex flex-col text-slate-900 font-sans">
        <header className="p-4 border-b flex justify-between items-center bg-slate-50/50"><div className="font-bold text-indigo-600">QB Mobile</div><div className="px-3 py-1 bg-white border rounded-full text-xs font-mono font-bold text-slate-500">ID: {sessionId}</div></header>
        <main className="flex-1 flex flex-col items-center justify-center p-8 space-y-8 text-center">
          {status === 'processing' || status === 'uploading' ? (
            <div className="space-y-4"><Loader2 className="w-12 h-12 text-indigo-600 animate-spin mx-auto" /><p className="font-bold text-lg">{status === 'uploading' ? 'Uploading...' : 'AI Thinking...'}</p></div>
          ) : status === 'ready' ? (
            <div className="space-y-6"><div className="w-20 h-20 bg-green-50 text-green-600 rounded-full flex items-center justify-center mx-auto"><CheckCircle2 size={32} /></div><h2 className="text-2xl font-bold">Variations Ready!</h2><button onClick={() => setStatus('waiting')} className="p-4 bg-indigo-600 text-white rounded-2xl font-bold w-full shadow-lg">Upload Another</button></div>
          ) : (
            <>
              <div className="w-24 h-24 bg-indigo-50 rounded-full flex items-center justify-center text-indigo-600"><Camera size={40} /></div>
              <div className="space-y-2"><h2 className="text-2xl font-bold">Snap a Question</h2><p className="text-slate-500 max-w-[250px] mx-auto text-sm">Take a clear photo of the problem.</p></div>
              <label className="flex items-center justify-center w-full gap-3 p-5 bg-indigo-600 text-white rounded-2xl font-black text-lg active:scale-95 cursor-pointer shadow-lg"><Camera size={20} />Open Camera<input type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFileUpload} /></label>
            </>
          )}
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col text-slate-900 font-sans">
      <header className="h-16 border-b bg-white flex items-center justify-between px-8 shrink-0">
        <div className="flex items-center gap-3"><div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white font-black text-xs italic">QB</div><span className="font-bold text-lg tracking-tight">Question Breaker</span></div>
        <div className="flex items-center gap-4"><div className="px-4 py-1.5 bg-slate-100 rounded-full text-sm font-mono font-bold text-indigo-600 uppercase tracking-widest">{sessionId}</div><button onClick={() => window.location.reload()} className="text-xs font-semibold text-slate-400">End Session</button></div>
      </header>
      <main className="flex-1 flex overflow-hidden">
        <div className="w-1/2 border-r bg-slate-50/50 flex flex-col relative">
          {data.imageUrl ? (
            <div className="flex-1 p-8"><img src={data.imageUrl} alt="Source" className="w-full h-full object-contain rounded-2xl shadow-2xl" /></div>
          ) : (
            <div className="flex-1 flex items-center justify-center p-12 text-center max-w-xs mx-auto space-y-6">
              <div className="w-20 h-20 bg-white rounded-3xl shadow-sm flex items-center justify-center mx-auto text-indigo-500"><Smartphone className="animate-bounce" /></div>
              <div><h4 className="font-bold text-lg">Connect Phone</h4><p className="text-slate-400 text-sm">Join <span className="underline font-bold text-indigo-600">{sessionId}</span> to upload.</p></div>
            </div>
          )}
          {status === 'processing' && (
             <div className="absolute inset-0 bg-white/60 backdrop-blur-sm flex flex-col items-center justify-center z-20 space-y-4">
                <Loader2 className="w-10 h-10 text-indigo-600 animate-spin" /><p className="font-bold">Gemini is analyzing...</p>
                <p className="text-[10px] uppercase font-bold text-slate-400 animate-pulse bg-slate-100 px-3 py-1 rounded-full">{aiStep}</p>
             </div>
          )}
        </div>
        <div className="w-1/2 bg-white flex flex-col overflow-y-auto">
          <div className="p-4 border-b sticky top-0 bg-white/90 backdrop-blur z-10 flex justify-between items-center px-8">
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-400">Logic Variations</h3>
            <div className="bg-indigo-50 text-indigo-600 px-2 py-1 rounded text-[10px] font-bold uppercase tracking-tighter">Gemini 3.1 Pro</div>
          </div>
          <div className="p-8 space-y-12">
            {status === 'ready' ? (
              <div className="space-y-10 pb-20">
                {data.variations.map((v, i) => (
                  <div key={i} className="group space-y-4 animate-in fade-in slide-in-from-right-4 duration-500" style={{ animationDelay: `${i*150}ms` }}>
                    <div className="flex items-center gap-2"><span className="text-[10px] font-black bg-indigo-600 text-white px-2 py-0.5 rounded uppercase tracking-wider">{v.category}</span><div className="h-px flex-1 bg-slate-100"></div></div>
                    <div className="text-slate-700 leading-relaxed text-lg prose prose-indigo"><Latex>{v.text}</Latex></div>
                    <button onClick={() => toggleSolution(i)} className="flex items-center gap-2 text-sm font-bold text-indigo-600 bg-indigo-50 px-4 py-2 rounded-full">{showSolutions[i] ? <EyeOff size={16} /> : <Eye size={16} />}{showSolutions[i] ? 'Hide Solution' : 'Show Solution'}</button>
                    {showSolutions[i] && <div className="mt-4 p-8 bg-slate-50 rounded-3xl border border-slate-100 text-slate-600 shadow-inner animate-in zoom-in-95"><div className="font-bold text-xs uppercase text-slate-400 mb-4 tracking-widest">Pedagogical Solution</div><Latex>{v.solution}</Latex></div>}
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

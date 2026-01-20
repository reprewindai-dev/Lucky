import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Upload, Download, Play, Pause, Settings, Zap, AudioLines, Music2, Sliders, Mic, StopCircle, Check, ChevronRight } from 'lucide-react';
import { useCreateTrack } from '@/hooks/use-tracks';
import { useTracks } from '@/hooks/use-tracks';
import { useToast } from '@/hooks/use-toast';
import { motion, AnimatePresence } from 'framer-motion';

// --- CORRECTED PRESET DEFINITIONS ---
const presets = {
  smoothmids: {
    name: "Smooth Mids",
    intent: "Velvet frequency response",
    description: "Warm, smooth midrange without harshness.",
    settings: {
      bass: 1,
      mid: 2, // Boost for warmth (was -2, wrong!)
      midFreq: 800, // Warm low-mids
      high: 0,
      ratio: 2.5,
      loudness: -9,
      subEQ: { freq: 3500, q: 2.0, gain: -2 } // Reduce upper mid harshness
    }
  },
  dynamic: {
    name: "Dynamic & Clear",
    intent: "Preserve transients",
    description: "Minimal compression, natural punch.",
    settings: {
      bass: 0,
      mid: 0,
      high: 2,
      ratio: 1.5, // Very light compression
      loudness: -10 // Quieter to preserve dynamics
    }
  },
  maximpact: {
    name: "Maximum Impact",
    intent: "Loud, punchy, aggressive",
    description: "Controlled loudness without distortion.",
    settings: {
      bass: 3,
      mid: 2,
      midFreq: 2000, // Punch frequency
      high: 2,
      ratio: 3.5, // Moderate compression for control
      loudness: -7 // Louder target
    }
  },
  modern: {
    name: "Modern Bright",
    intent: "Airy, high-definition sheen",
    description: "Open highs without harshness.",
    settings: {
      bass: 0,
      mid: 0,
      high: 3, // Air boost
      ratio: 2.0,
      loudness: -9,
      subEQ: { freq: 5000, q: 1.5, gain: -1.5 } // Tame harsh sibilance
    }
  },
  lofi: {
    name: "Lo-Fi Character",
    intent: "Gritty, textured sound",
    description: "Controlled saturation and compression.",
    settings: {
      bass: 2,
      mid: 0,
      high: -4, // Roll off highs for lo-fi feel
      ratio: 3.0, // More compression for "pumping"
      loudness: -10
    }
  },
  neosoul: {
    name: "Neo Soul",
    intent: "Deep, organic resonance",
    description: "Warm mids, soft highs, musical compression.",
    settings: {
      bass: 3, // Warm low end
      mid: 3,
      midFreq: 600, // Warm, full mids
      high: -1, // Soft highs
      ratio: 2.0, // Gentle compression
      loudness: -9
    }
  },
  festival: {
    name: "Festival Banger",
    intent: "Maximum energy and impact",
    description: "Loud but stable, controlled bass.",
    settings: {
      bass: 4,
      mid: 2,
      high: 2,
      ratio: 3.5, // Strong compression for consistency
      loudness: -7 // Loud
    }
  },
  focus: {
    name: "Focus Center",
    intent: "Mono-compatible punch",
    description: "Center-focused, strong mono image.",
    settings: {
      bass: 2,
      mid: 3,
      midFreq: 1000, // Center energy
      high: 0,
      ratio: 2.5,
      loudness: -9
    }
  },
  immersive: {
    name: "Immersive",
    intent: "3D Spatial depth",
    description: "Subtle width, clear space.",
    settings: {
      bass: 0,
      mid: 1,
      high: 3, // Air for space
      ratio: 2.0, // Light compression preserves space
      loudness: -9
    }
  },
  wide: {
    name: "Wide & Spacious",
    intent: "Extreme stereo width",
    description: "Wide but mono-safe.",
    settings: {
      bass: -1, // Reduce bass width
      mid: 0,
      high: 4, // Wide highs
      ratio: 2.0,
      loudness: -9
    }
  },
  vocalforward: {
    name: "Vocal Forward",
    intent: "Lyrics front and center",
    description: "Vocal clarity without harshness.",
    settings: {
      bass: 0,
      mid: 4,
      midFreq: 3000, // Vocal presence (was 1500, too nasal!)
      high: 1,
      ratio: 2.5,
      loudness: -9,
      subEQ: { freq: 250, q: 1.0, gain: -2 } // Remove mud from vocals
    }
  },
  bigcappo: {
    name: "BigCappo (Signature)",
    intent: "Emotional, human Trap-Soul",
    description: "Natural warmth, expressive dynamics.",
    settings: {
      bass: 3, // Warm low end
      mid: 3,
      midFreq: 800, // Warm, emotional mids
      high: 1,
      ratio: 2.0, // Light compression preserves emotion
      loudness: -9
    }
  },
  deharsh: {
    name: "De-Harsh",
    intent: "Control aggressive high-end",
    description: "Tame harshness, keep energy.",
    settings: {
      bass: 0,
      mid: 0,
      high: -2, // Reduce harsh highs
      ratio: 2.5,
      loudness: -9,
      subEQ: { freq: 4000, q: 2.5, gain: -4 } // Surgically remove harshness
    }
  },
  mudremover: {
    name: "Mud Remover",
    intent: "Clean up low-mid buildup",
    description: "Clear, tight low end.",
    settings: {
      bass: -1,
      mid: 1,
      high: 1,
      ratio: 2.0,
      loudness: -9,
      subEQ: { freq: 250, q: 1.5, gain: -3 } // Remove mud at 250Hz
    }
  },
  vintage: {
    name: "Vintage Warmth",
    intent: "Analog saturation feel",
    description: "Warm lows, soft highs.",
    settings: {
      bass: 3,
      mid: 1,
      high: -2, // Soften highs
      ratio: 2.5,
      loudness: -9
    }
  }
};

// --- CORRECTED MASTERING ENGINE ---
const processAudioPremium = async (audioBuffer: AudioBuffer, preset: any, useAutoTune = false) => {
  const offlineCtx = new OfflineAudioContext(audioBuffer.numberOfChannels, audioBuffer.length, audioBuffer.sampleRate);
  const source = offlineCtx.createBufferSource();
  source.buffer = audioBuffer;

  let chain: AudioNode = source;

  // STAGE 1: Input Trim (normalize to -6dBFS headroom)
  const inputGain = offlineCtx.createGain();
  let peakLevel = 0;
  for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
    const channelData = audioBuffer.getChannelData(ch);
    for (let i = 0; i < channelData.length; i++) {
      peakLevel = Math.max(peakLevel, Math.abs(channelData[i]));
    }
  }
  // Target -6dB input = 0.5 in linear (gives headroom for processing)
  const inputTrim = peakLevel > 0 ? (0.5 / peakLevel) : 1.0;
  inputGain.gain.value = inputTrim;
  chain.connect(inputGain);
  chain = inputGain;

  // STAGE 2: Sub-Bass HPF (remove rumble below 30Hz)
  const hpf = offlineCtx.createBiquadFilter();
  hpf.type = 'highpass';
  hpf.frequency.value = 30;
  hpf.Q.value = 0.707; // Butterworth response
  chain.connect(hpf);
  chain = hpf;

  // STAGE 3: Subtractive EQ (problem frequency removal)
  if (preset.settings.subEQ) {
    const subEQ = offlineCtx.createBiquadFilter();
    subEQ.type = 'peaking';
    subEQ.frequency.value = preset.settings.subEQ.freq;
    subEQ.Q.value = preset.settings.subEQ.q;
    subEQ.gain.value = preset.settings.subEQ.gain; // should be negative
    chain.connect(subEQ);
    chain = subEQ;
  }

  // STAGE 4: Tone Shaping EQ (Low/Mid/High)
  const bassShelf = offlineCtx.createBiquadFilter();
  bassShelf.type = 'lowshelf';
  bassShelf.frequency.value = 100; // Bass shelf at 100Hz
  bassShelf.gain.value = preset.settings.bass;
  chain.connect(bassShelf);
  chain = bassShelf;

  const midPeak = offlineCtx.createBiquadFilter();
  midPeak.type = 'peaking';
  midPeak.frequency.value = preset.settings.midFreq || 1500; // Adjustable mid frequency
  midPeak.Q.value = 1.0;
  midPeak.gain.value = preset.settings.mid;
  chain.connect(midPeak);
  chain = midPeak;

  const highShelf = offlineCtx.createBiquadFilter();
  highShelf.type = 'highshelf';
  highShelf.frequency.value = 8000; // Air shelf at 8kHz (more musical than 12k)
  highShelf.gain.value = preset.settings.high;
  chain.connect(highShelf);
  chain = highShelf;

  // STAGE 5: Compression (single stage, musical settings)
  const comp = offlineCtx.createDynamicsCompressor();
  comp.threshold.value = -20; // Gentle threshold
  comp.knee.value = 12; // Soft knee for musicality
  comp.ratio.value = Math.min(4, Math.max(1.5, preset.settings.ratio)); // Max 4:1
  comp.attack.value = 0.010; // 10ms - musical for transients
  comp.release.value = 0.150; // 150ms - natural release
  chain.connect(comp);
  chain = comp;

  // STAGE 6: Output Limiter (safety only, not for loudness)
  const limiter = offlineCtx.createDynamicsCompressor();
  limiter.threshold.value = -0.5; // Catch peaks only
  limiter.knee.value = 0.5; // Very soft knee
  limiter.ratio.value = 20; // Hard limiting
  limiter.attack.value = 0.001; // Fast attack for peaks
  limiter.release.value = 0.100; // Quick release
  chain.connect(limiter);
  chain = limiter;

  // STAGE 7: Output Gain (makeup gain for competitive loudness)
  const outputGain = offlineCtx.createGain();
  // After compression, we need to BOOST to competitive levels
  // loudness: -9 = moderate loud, -7 = very loud
  // Calculate makeup gain: more negative loudness = louder output
  const targetDB = preset.settings.loudness; // e.g., -9 or -7
  const makeupBoost = -targetDB; // -9 becomes +9, -7 becomes +7
  // Convert to linear: +9dB = 2.8x, +7dB = 2.2x
  const linearGain = Math.pow(10, makeupBoost / 20);
  // Scale it down slightly to avoid clipping after limiting (0.4x multiplier)
  outputGain.gain.value = linearGain * 0.4;
  chain.connect(outputGain);
  chain = outputGain;

  // Connect to destination
  chain.connect(offlineCtx.destination);

  source.start(0);
  return await offlineCtx.startRendering();
};

const bufferToWav = (buffer: AudioBuffer) => {
  const numberOfChannels = buffer.numberOfChannels;
  const length = buffer.length * numberOfChannels * 2;
  const arrayBuffer = new ArrayBuffer(44 + length);
  const view = new DataView(arrayBuffer);
  const writeString = (offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) view.setUint8(offset + i, string.charCodeAt(i));
  };
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + length, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numberOfChannels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * numberOfChannels * 2, true);
  view.setUint16(32, numberOfChannels * 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, length, true);
  let offset = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let channel = 0; channel < numberOfChannels; channel++) {
      const sample = Math.max(-1, Math.min(1, buffer.getChannelData(channel)[i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
      offset += 2;
    }
  }
  return new Blob([arrayBuffer], { type: 'audio/wav' });
};

export default function AudioMasteringApp() {
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [processedBuffer, setProcessedBuffer] = useState<AudioBuffer | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<keyof typeof presets>('deharsh');
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [useAutoTune, setUseAutoTune] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [lyrics, setLyrics] = useState<string>("");
  const [compareMode, setCompareMode] = useState<'original' | 'preset'>('preset');
  const holdTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Prevent stacked play() calls from async timeouts / rapid taps (very common on mobile).
  const playTokenRef = useRef(0);
  const pendingStartTimeoutRef = useRef<number | null>(null);
  const compareModeRef = useRef<'original' | 'preset'>(compareMode);

  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const startTimeRef = useRef(0);
  const animationFrameRef = useRef<number>();
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const createTrackMutation = useCreateTrack();

  useEffect(() => {
    return () => {
      if (audioContextRef.current) audioContextRef.current.close();
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, []);

  useEffect(() => {
    compareModeRef.current = compareMode;
  }, [compareMode]);

  const clearPendingStart = () => {
    if (pendingStartTimeoutRef.current !== null) {
      window.clearTimeout(pendingStartTimeoutRef.current);
      pendingStartTimeoutRef.current = null;
    }
  };

  const stopAudio = () => {
    clearPendingStart();
    if (sourceNodeRef.current) {
      try { sourceNodeRef.current.stop(); } catch(e) {}
      try { sourceNodeRef.current.disconnect(); } catch(e) {}
      sourceNodeRef.current = null;
    }
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    setIsPlaying(false);
  };

  const applyPremiumProcessing = async (
    buffer: AudioBuffer,
    presetKey: keyof typeof presets,
    autoTune = useAutoTune
  ) => {
    setIsProcessing(true);
    try {
      // Token-gate: if the user taps presets rapidly, only the latest request should win.
      const token = ++playTokenRef.current;
      const processed = await processAudioPremium(buffer, presets[presetKey], autoTune);
      if (token !== playTokenRef.current) return null;

      setProcessedBuffer(processed);
      setSelectedPreset(presetKey);

      // Persist history (best-effort, no hard fail on mobile).
      if (file) {
        createTrackMutation.mutate(
          {
            filename: file.name,
            preset: presetKey,
            format: "wav",
            videoStatus: "none",
            lyrics: lyrics || undefined,
          } as any,
          { onError: () => {} }
        );
      }

      return processed;
    } catch (error) {
      console.error(error);
      toast({ title: "Analysis Failed", description: "Could not apply premium algorithm.", variant: "destructive" });
      return null;
    } finally {
      setIsProcessing(false);
    }
  };

  const handlePresetInteraction = async (presetKey: keyof typeof presets) => {
    if (!audioBuffer) return;

    // Single-source-of-truth playback rule:
    // - tapping a preset always stops any current playback
    // - only one preset can play at a time
    const resumeAt = isPlaying ? currentTime : 0;
    stopAudio();

    // Same preset tap = toggle off
    if (selectedPreset === presetKey && compareModeRef.current === 'preset') {
      return;
    }

    // Process the new preset and then start exactly one playback instance.
    const processed = await applyPremiumProcessing(audioBuffer, presetKey);
    if (!processed) return;

    setCompareMode('preset');
    pendingStartTimeoutRef.current = window.setTimeout(() => {
      startPlayback(resumeAt, 'preset');
    }, 0);
  };

  const handleHoldStart = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isPlaying) return;
    if (e.cancelable) e.preventDefault();
    const currentPos = currentTime;
    setCompareMode('original');
    stopAudio();
    pendingStartTimeoutRef.current = window.setTimeout(() => {
      startPlayback(currentPos, 'original');
    }, 0);
  };

  const handleHoldEnd = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isPlaying || compareModeRef.current === 'preset') return;
    const currentPos = currentTime;
    setCompareMode('preset');
    stopAudio();
    pendingStartTimeoutRef.current = window.setTimeout(() => {
      startPlayback(currentPos, 'preset');
    }, 0);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;
    setFile(selectedFile);
    setIsProcessing(true);
    try {
      const arrayBuffer = await selectedFile.arrayBuffer();
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const decodedBuffer = await ctx.decodeAudioData(arrayBuffer);
      setAudioBuffer(decodedBuffer);
      setDuration(decodedBuffer.duration);
      audioContextRef.current = ctx;
      await applyPremiumProcessing(decodedBuffer, 'deharsh');
    } catch (error) {
      toast({ title: "Read Error", description: "Invalid audio format.", variant: "destructive" });
    } finally {
      setIsProcessing(false);
    }
  };

  const toggleCompare = () => {
    const nextMode = compareModeRef.current === 'preset' ? 'original' : 'preset';
    setCompareMode(nextMode);
    if (isPlaying) {
      const currentPos = currentTime;
      stopAudio();
      pendingStartTimeoutRef.current = window.setTimeout(() => {
        startPlayback(currentPos, nextMode);
      }, 0);
    }
  };

  const startPlayback = async (offset = 0, mode: 'original' | 'preset' = compareModeRef.current) => {
    if (!audioContextRef.current) return;
    // Safety: never allow multiple overlapping sources.
    clearPendingStart();
    if (sourceNodeRef.current) stopAudio();

    // iOS: AudioContext often starts "suspended" until a user gesture resumes it.
    try {
      if (audioContextRef.current.state === 'suspended') await audioContextRef.current.resume();
    } catch {}

    const bufferToUse = mode === 'preset' ? processedBuffer : audioBuffer;
    if (!bufferToUse) return;

    const source = audioContextRef.current.createBufferSource();
    source.buffer = bufferToUse;
    source.connect(audioContextRef.current.destination);
    source.start(0, offset);

    source.onended = () => {
      // Only stop if this is still the active source.
      if (sourceNodeRef.current === source) {
        stopAudio();
        setCurrentTime(0);
      }
    };
    
    startTimeRef.current = audioContextRef.current.currentTime - offset;
    sourceNodeRef.current = source;
    setIsPlaying(true);

    const updateProgress = () => {
      if (!audioContextRef.current) return;
      const current = audioContextRef.current.currentTime - startTimeRef.current;
      if (current >= duration) { stopAudio(); setCurrentTime(0); }
      else { setCurrentTime(current); animationFrameRef.current = requestAnimationFrame(updateProgress); }
    };
    animationFrameRef.current = requestAnimationFrame(updateProgress);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const exportAudio = async () => {
    if (!processedBuffer || !file) return;
    setIsProcessing(true);
    try {
      const blob = bufferToWav(processedBuffer);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `trapmaster-pro-${selectedPreset}-${file.name.split('.')[0]}.wav`;
      a.click();
      URL.revokeObjectURL(url); // Clean up memory
      toast({ title: "Export Complete", description: `Mastered audio saved as WAV` });
    } catch (e) {
      console.error("Export error:", e);
      toast({ title: "Export Error", description: "Failed to export audio. Please try again.", variant: "destructive" });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#050505] text-white p-4 md:p-8 font-sans selection:bg-purple-500/30 overflow-x-hidden">
      <div className="max-w-5xl mx-auto space-y-10 pb-20">
        <div className="flex flex-col items-center text-center space-y-4">
          <motion.div 
            whileHover={{ scale: 1.05 }} 
            className={`p-1 rounded-full bg-gradient-to-b from-purple-500 to-pink-600 shadow-2xl shadow-purple-500/20`}
          >
            <button 
              onClick={isRecording ? () => {} : () => {}} 
              className="bg-black p-6 rounded-full"
            >
              <Mic className="w-8 h-8 text-white" />
            </button>
          </motion.div>
          <h1 className="text-5xl font-black tracking-tighter italic bg-gradient-to-r from-white via-purple-200 to-gray-500 bg-clip-text text-transparent uppercase">
            Trap Master Pro
          </h1>
          <p className="text-gray-500 text-xs font-bold uppercase tracking-[0.3em] opacity-60">Professional DSP Mastering Engine</p>
        </div>

        {!audioBuffer ? (
          <div className="relative group overflow-hidden rounded-[2.5rem] bg-[#0a0a0a] border border-white/5 p-20 text-center transition-all hover:border-purple-500/40">
            <input type="file" accept="audio/*,video/*,.mp3,.wav,.m4a,.aac,.ogg,.flac,.wma,.aiff,.mp4,.mov,.avi,.mkv,.webm" onChange={handleFileUpload} className="absolute inset-0 opacity-0 cursor-pointer z-10" />
            <div className="space-y-6">
              <div className="w-20 h-20 mx-auto bg-white/5 rounded-3xl flex items-center justify-center group-hover:bg-purple-500/10 transition-colors">
                <Upload className="w-8 h-8 text-gray-400 group-hover:text-purple-400 transition-colors" />
              </div>
              <div>
                <h2 className="text-xl font-bold mb-2">Initialize Audio DNA</h2>
                <p className="text-gray-500 text-sm max-w-xs mx-auto">Drop your full mix (vocals + beat) here for deep adaptive analysis.</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            {/* Playback & Analysis Section */}
            <div className="lg:col-span-7 space-y-8">
              <div className="bg-[#0a0a0a] border border-white/5 rounded-[2.5rem] p-10 space-y-8 relative overflow-hidden">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="p-3 bg-purple-500/10 rounded-2xl">
                      <Music2 className="text-purple-400 w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="font-bold truncate max-w-[200px]">{file?.name}</h3>
                      <div className="flex gap-3 mt-1">
                        <span className="text-[10px] font-black bg-white/5 px-2 py-0.5 rounded text-gray-400 uppercase tracking-widest">Premium Lossless</span>
                        <span className="text-[10px] font-black bg-purple-500/20 px-2 py-0.5 rounded text-purple-300 uppercase tracking-widest">{formatTime(duration)}</span>
                      </div>
                    </div>
                  </div>
                  <button 
                    onClick={toggleCompare}
                    className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${compareMode === 'original' ? 'bg-red-500 text-white shadow-lg shadow-red-500/20' : 'bg-white/5 text-gray-400 hover:bg-white/10'}`}
                  >
                    {compareMode === 'original' ? 'A (Original)' : 'B (Mastered)'}
                  </button>
                </div>

                <div className="flex items-center gap-8">
                  <button 
                    onClick={isPlaying ? stopAudio : () => startPlayback(currentTime)} 
                    className="w-20 h-20 rounded-full bg-white text-black flex items-center justify-center hover:scale-105 active:scale-95 transition-all shadow-2xl"
                  >
                    {isPlaying ? <Pause className="w-8 h-8 fill-current" /> : <Play className="w-8 h-8 ml-1 fill-current" />}
                  </button>
                  <div className="flex-1 space-y-4">
                    <div className="relative h-3 bg-white/5 rounded-full overflow-hidden cursor-pointer">
                      <motion.div 
                        className="h-full bg-gradient-to-r from-purple-500 to-pink-500 relative"
                        animate={{ width: `${(currentTime/duration)*100}%` }}
                        transition={{ type: "spring", bounce: 0, duration: 0.1 }}
                      />
                    </div>
                    <div className="flex justify-between text-[10px] font-black text-gray-500 font-mono tracking-widest">
                      <span>{formatTime(currentTime)}</span>
                      <span className="text-purple-500 opacity-60">HD PROCESSING ACTIVE</span>
                      <span>{formatTime(duration)}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* BigCappo Signature Section */}
              <button 
                onClick={() => handlePresetInteraction('bigcappo')}
                onMouseDown={handleHoldStart}
                onMouseUp={handleHoldEnd}
                onMouseLeave={handleHoldEnd}
                onTouchStart={handleHoldStart}
                onTouchEnd={handleHoldEnd}
                onTouchCancel={handleHoldEnd}
                className={`w-full group relative overflow-hidden rounded-[2.5rem] p-8 text-left transition-all border touch-none select-none ${selectedPreset === 'bigcappo' ? 'bg-gradient-to-br from-purple-900/40 to-black border-purple-500' : 'bg-[#0a0a0a] border-white/5 hover:border-purple-500/40'}`}
              >
                <div className="relative z-10 flex items-center justify-between">
                  <div className="space-y-2">
                    <div className="flex items-center gap-3">
                      <Zap className={`w-5 h-5 ${selectedPreset === 'bigcappo' ? 'text-purple-400' : 'text-gray-500'}`} />
                      <h4 className="text-xl font-black uppercase tracking-tighter">BigCappo Signature</h4>
                    </div>
                    <p className="text-sm text-gray-500 font-medium">Emotional Trap-Soul vocals. Human, expressive, never robotic.</p>
                  </div>
                  <ChevronRight className={`w-6 h-6 transition-transform ${selectedPreset === 'bigcappo' ? 'text-purple-400' : 'text-gray-800'}`} />
                </div>
                {selectedPreset === 'bigcappo' && (
                  <motion.div 
                    layoutId="active-glow"
                    className="absolute inset-0 bg-purple-500/5 blur-3xl -z-0"
                  />
                )}
              </button>
            </div>

            {/* Presets Grid */}
            <div className="lg:col-span-5 space-y-6">
              <h4 className="text-[10px] font-black text-gray-600 uppercase tracking-[0.4em] ml-4">Personality Presets</h4>
              <div className="grid grid-cols-2 gap-4">
                {Object.entries(presets).filter(([k]) => k !== 'bigcappo').map(([key, preset]) => (
                  <button 
                    key={key} 
                    onClick={() => handlePresetInteraction(key as any)}
                    onMouseDown={handleHoldStart}
                    onMouseUp={handleHoldEnd}
                    onMouseLeave={handleHoldEnd}
                    onTouchStart={handleHoldStart}
                    onTouchEnd={handleHoldEnd}
                    onTouchCancel={handleHoldEnd}
                    className={`group p-5 rounded-3xl text-left border transition-all touch-none select-none ${selectedPreset === key ? 'bg-white/5 border-purple-500 ring-1 ring-purple-500/20' : 'bg-[#0a0a0a] border-white/5 hover:bg-white/[0.02]'}`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <h5 className={`text-xs font-black uppercase tracking-tight ${selectedPreset === key ? 'text-purple-400' : 'text-gray-300'}`}>
                        {preset.name}
                      </h5>
                      {selectedPreset === key && isPlaying && <div className="w-2 h-2 rounded-full bg-purple-400 animate-pulse" />}
                      {selectedPreset === key && !isPlaying && <Check className="w-3 h-3 text-purple-400" />}
                    </div>
                    <p className="text-[10px] text-gray-600 font-medium leading-relaxed">{preset.intent}</p>
                  </button>
                ))}
              </div>

              <div className="pt-6">
                <button onClick={exportAudio} disabled={isProcessing || !processedBuffer} className="w-full p-6 bg-gradient-to-r from-purple-500 to-pink-500 rounded-[2rem] font-black text-sm uppercase tracking-widest hover:from-purple-600 hover:to-pink-600 transition-all flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed">
                  <Download className="w-6 h-6" />
                  Export Mastered WAV
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

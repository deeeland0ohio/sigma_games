import React, { createContext, useContext, useState, useEffect, useRef, type ReactNode } from 'react';
import Hls from 'hls.js';
import { storage } from '../utils/storage';

export interface MusicTrack {
  id: string | number;
  rawId?: string | number;
  name: string;
  artist: string;
  isVerified?: boolean;
  album?: string;
  pic?: string;
  url?: string;
  previewUrl?: string;
  lrc?: string;
  source?: string;
  picId?: string;
  urlId?: string | number;
  lyricId?: string | number;
  duration?: number;
  formattedDuration?: string;
  media?: any;
  isSpedUp?: boolean;
  isSlowed?: boolean;
}

interface MusicContextType {
  currentTrack: MusicTrack | null;
  isPlaying: boolean;
  playlist: MusicTrack[];
  currentIndex: number;
  volume: number;
  currentTime: number;
  duration: number;
  isLoadingAudio: boolean;
  isRepeating: boolean;
  lyrics: string;
  currentLyricLine: string;
  isMusicOpen: boolean;
  playTrack: (track: MusicTrack, newPlaylist?: MusicTrack[]) => Promise<void>;
  togglePlay: () => void;
  stopMusic: () => void;
  nextTrack: () => void;
  prevTrack: () => void;
  toggleRepeat: () => void;
  setVolume: (vol: number) => void;
  seek: (time: number) => void;
  setIsMusicOpen: (open: boolean) => void;
  setPlaylist: (list: MusicTrack[]) => void;
}

const MusicContext = createContext<MusicContextType | undefined>(undefined);

function formatSeconds(secs: number): string {
  if (!secs || isNaN(secs) || secs <= 0) return "0:00";
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function MusicProvider({ children }: { children: ReactNode }) {
  const [currentTrack, setCurrentTrack] = useState<MusicTrack | null>(() => {
    const saved = storage.getItem('app-music-current-track');
    return saved ? JSON.parse(saved) : null;
  });

  const [playlist, setPlaylist] = useState<MusicTrack[]>(() => {
    const saved = storage.getItem('app-music-playlist');
    return saved ? JSON.parse(saved) : [];
  });

  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolumeState] = useState<number>(() => {
    const saved = storage.getItem('app-music-volume');
    return saved ? parseFloat(saved) : 0.7;
  });

  const [isRepeating, setIsRepeating] = useState<boolean>(() => {
    const saved = storage.getItem('app-music-repeat');
    return saved === 'true';
  });

  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);
  const [lyrics, setLyrics] = useState('');
  const [parsedLyrics, setParsedLyrics] = useState<{ time: number; text: string }[]>([]);
  const [currentLyricLine, setCurrentLyricLine] = useState('');

  // Watchdog timer: ensure isLoadingAudio never gets stuck permanently
  useEffect(() => {
    if (!isLoadingAudio) return;
    const timer = setTimeout(() => {
      setIsLoadingAudio(false);
    }, 7000);
    return () => clearTimeout(timer);
  }, [isLoadingAudio]);
  const [isMusicOpen, setIsMusicOpen] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const playRequestIdRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Sync refs to avoid stale closures inside event listeners
  const playlistRef = useRef<MusicTrack[]>(playlist);
  const currentTrackRef = useRef<MusicTrack | null>(currentTrack);
  const isRepeatingRef = useRef<boolean>(isRepeating);

  useEffect(() => {
    playlistRef.current = playlist;
  }, [playlist]);

  useEffect(() => {
    currentTrackRef.current = currentTrack;
  }, [currentTrack]);

  useEffect(() => {
    isRepeatingRef.current = isRepeating;
    storage.setItem('app-music-repeat', String(isRepeating));
  }, [isRepeating]);

  // Advance to next track in queue
  const nextTrack = () => {
    const list = playlistRef.current;
    if (!list || list.length === 0) return;

    const curr = currentTrackRef.current;
    const currentIdx = curr ? list.findIndex(t => String(t.id) === String(curr.id)) : -1;
    const nextIdx = (currentIdx + 1) % list.length;
    playTrack(list[nextIdx]);
  };

  // Play previous track in queue
  const prevTrack = () => {
    const list = playlistRef.current;
    if (!list || list.length === 0) return;

    const curr = currentTrackRef.current;
    const currentIdx = curr ? list.findIndex(t => String(t.id) === String(curr.id)) : -1;
    const prevIdx = (currentIdx - 1 + list.length) % list.length;
    playTrack(list[prevIdx]);
  };

  // Toggle repeat mode
  const toggleRepeat = () => {
    setIsRepeating(prev => !prev);
  };

  // Initialize audio element
  useEffect(() => {
    const audio = new Audio();
    audio.preload = 'auto';
    audio.volume = volume;
    audioRef.current = audio;

    const onTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
    };

    const onLoadedMetadata = () => {
      if (audio.duration && isFinite(audio.duration) && audio.duration > 0) {
        setDuration(audio.duration);
      }
      setIsLoadingAudio(false);
    };

    const onDurationChange = () => {
      if (audio.duration && isFinite(audio.duration) && audio.duration > 0) {
        setDuration(audio.duration);
      }
    };

    const onCanPlay = () => {
      setIsLoadingAudio(false);
    };

    const onWaiting = () => {
      setIsLoadingAudio(true);
    };

    const onPlaying = () => {
      setIsLoadingAudio(false);
      setIsPlaying(true);
    };

    const onPause = () => {
      setIsPlaying(false);
    };

    const onEnded = () => {
      if (isRepeatingRef.current && audioRef.current) {
        audioRef.current.currentTime = 0;
        audioRef.current.play().catch(() => {
          if (currentTrackRef.current) {
            playTrack(currentTrackRef.current);
          }
        });
      } else {
        nextTrack();
      }
    };

    const onError = (e: Event) => {
      const currentSrc = audio.getAttribute('src');
      if (!currentSrc || currentSrc === '' || audio.src === window.location.href) {
        return;
      }
      console.warn('Audio playback event error:', audio.src, e);
      setIsLoadingAudio(false);
      setIsPlaying(false);
    };

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('durationchange', onDurationChange);
    audio.addEventListener('canplay', onCanPlay);
    audio.addEventListener('waiting', onWaiting);
    audio.addEventListener('playing', onPlaying);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      audio.pause();
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('durationchange', onDurationChange);
      audio.removeEventListener('canplay', onCanPlay);
      audio.removeEventListener('waiting', onWaiting);
      audio.removeEventListener('playing', onPlaying);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
    };
  }, []);

  // Update volume
  const setVolume = (vol: number) => {
    const clamped = Math.max(0, Math.min(1, vol));
    setVolumeState(clamped);
    storage.setItem('app-music-volume', clamped.toString());
    if (audioRef.current) {
      audioRef.current.volume = clamped;
    }
  };

  // Seek
  const seek = (time: number) => {
    if (audioRef.current && isFinite(time)) {
      audioRef.current.currentTime = time;
      setCurrentTime(time);
    }
  };

  // Parse lyrics LRC
  useEffect(() => {
    if (!lyrics) {
      setParsedLyrics([]);
      setCurrentLyricLine('');
      return;
    }

    const lines = lyrics.split('\n');
    const result: { time: number; text: string }[] = [];
    const timeReg = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/;

    for (const line of lines) {
      const match = timeReg.exec(line);
      if (match) {
        const min = parseInt(match[1], 10);
        const sec = parseInt(match[2], 10);
        const ms = parseInt(match[3].padEnd(3, '0'), 10);
        const totalSec = min * 60 + sec + ms / 1000;
        const text = line.replace(timeReg, '').trim();
        if (text) {
          result.push({ time: totalSec, text });
        }
      }
    }

    result.sort((a, b) => a.time - b.time);
    setParsedLyrics(result);
  }, [lyrics]);

  // Sync current lyric line
  useEffect(() => {
    if (parsedLyrics.length === 0) {
      setCurrentLyricLine('');
      return;
    }

    let active = '';
    for (let i = 0; i < parsedLyrics.length; i++) {
      if (currentTime >= parsedLyrics[i].time) {
        active = parsedLyrics[i].text;
      } else {
        break;
      }
    }
    setCurrentLyricLine(active);
  }, [currentTime, parsedLyrics]);

  // Play audio source with HLS or native audio support
  const applyAudioSourceAndPlay = async (audioUrl: string, expectedRequestId?: number): Promise<boolean> => {
    if (!audioRef.current) return false;
    if (expectedRequestId !== undefined && playRequestIdRef.current !== expectedRequestId) {
      return false;
    }

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    // Reset audio element state before loading new source
    audioRef.current.pause();
    audioRef.current.removeAttribute('src');

    const isHls = audioUrl.includes('.m3u8') || audioUrl.includes('hls') || audioUrl.includes('playlist');

    if (isHls && Hls.isSupported()) {
      return new Promise<boolean>((resolve) => {
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: true,
          fragLoadingTimeOut: 8000,
          manifestLoadingTimeOut: 8000
        });
        hlsRef.current = hls;
        hls.loadSource(audioUrl);
        hls.attachMedia(audioRef.current!);

        let hasResolved = false;
        const safetyTimer = setTimeout(() => {
          if (!hasResolved) {
            hasResolved = true;
            setIsLoadingAudio(false);
            resolve(false);
          }
        }, 9000);

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (expectedRequestId !== undefined && playRequestIdRef.current !== expectedRequestId) {
            clearTimeout(safetyTimer);
            hls.destroy();
            resolve(false);
            return;
          }
          if (audioRef.current) {
            audioRef.current.play().then(() => {
              clearTimeout(safetyTimer);
              if (!hasResolved) {
                hasResolved = true;
                setIsPlaying(true);
                setIsLoadingAudio(false);
                resolve(true);
              }
            }).catch(e => {
              clearTimeout(safetyTimer);
              console.warn('HLS play warning:', e);
              setIsLoadingAudio(false);
              if (!hasResolved) {
                hasResolved = true;
                resolve(false);
              }
            });
          }
        });

        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) {
            clearTimeout(safetyTimer);
            hls.destroy();
            hlsRef.current = null;
            setIsLoadingAudio(false);
            if (!hasResolved) {
              hasResolved = true;
              resolve(false);
            }
          }
        });
      });
    } else if (isHls && audioRef.current.canPlayType('application/vnd.apple.mpegurl')) {
      audioRef.current.src = audioUrl;
      audioRef.current.load();
      try {
        await audioRef.current.play();
        if (expectedRequestId !== undefined && playRequestIdRef.current !== expectedRequestId) {
          return false;
        }
        setIsPlaying(true);
        setIsLoadingAudio(false);
        return true;
      } catch {
        setIsLoadingAudio(false);
        return false;
      }
    }

    // Standard Direct Audio (MP3 / AAC / WAV)
    return new Promise<boolean>((resolve) => {
      if (!audioRef.current) return resolve(false);

      let hasResolved = false;
      const safetyTimer = setTimeout(() => {
        if (!hasResolved) {
          hasResolved = true;
          setIsLoadingAudio(false);
          resolve(false);
        }
      }, 9000);

      audioRef.current.src = audioUrl;
      audioRef.current.load();

      audioRef.current.play().then(() => {
        clearTimeout(safetyTimer);
        if (expectedRequestId !== undefined && playRequestIdRef.current !== expectedRequestId) {
          resolve(false);
          return;
        }
        setIsPlaying(true);
        setIsLoadingAudio(false);
        if (!hasResolved) {
          hasResolved = true;
          resolve(true);
        }
      }).catch(async (err) => {
        clearTimeout(safetyTimer);
        console.warn('Direct audio play catch, trying proxy fallback:', err);
        // If direct stream was blocked by browser or network filter, attempt proxy stream
        if (!audioUrl.startsWith('/api/music/proxy') && audioUrl.startsWith('http')) {
          try {
            const proxyUrl = `/api/music/proxy?url=${encodeURIComponent(audioUrl)}`;
            if (audioRef.current && (expectedRequestId === undefined || playRequestIdRef.current === expectedRequestId)) {
              audioRef.current.src = proxyUrl;
              audioRef.current.load();
              await audioRef.current.play();
              setIsPlaying(true);
              setIsLoadingAudio(false);
              if (!hasResolved) {
                hasResolved = true;
                resolve(true);
              }
              return;
            }
          } catch (proxyErr) {
            console.warn('Proxy fallback playback failed:', proxyErr);
          }
        }

        setIsLoadingAudio(false);
        if (!hasResolved) {
          hasResolved = true;
          resolve(false);
        }
      });
    });
  };

  // Play track with robust stream resolution, race-condition safety, and instant-stop
  const playTrack = async (track: MusicTrack, newPlaylist?: MusicTrack[]) => {
    // 1. Immediately abort any in-flight track resolution request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    const { signal } = abortController;

    const currentRequestId = ++playRequestIdRef.current;

    // 2. IMMEDIATELY STOP PREVIOUS AUDIO so old song stops playing right away
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.removeAttribute('src');
      audioRef.current.load();
    }
    setIsPlaying(false);
    setCurrentTime(0);

    if (newPlaylist) {
      setPlaylist(newPlaylist);
      storage.setItem('app-music-playlist', JSON.stringify(newPlaylist));
    }

    setCurrentTrack(track);
    storage.setItem('app-music-current-track', JSON.stringify(track));
    setIsLoadingAudio(true);
    setLyrics('');

    if (track.duration && track.duration > 0) {
      setDuration(track.duration);
    }

    try {
      let audioUrl = track.url;
      let picUrl = track.pic;
      let resolvedDuration = track.duration;

      const targetId = track.rawId || track.id;
      const trackSource = track.source || (String(track.id).startsWith('octave_') ? 'Octave' : 'soundcloud');

      // Resolve full stream if URL is empty or unresolved
      if (!audioUrl || audioUrl.startsWith('/api/music/url')) {
        const queryParams = new URLSearchParams({
          id: String(track.id || targetId),
          name: track.name || '',
          artist: track.artist || '',
          previewUrl: track.previewUrl || '',
          source: trackSource,
          duration: String(track.duration || 0),
          isSpedUp: track.isSpedUp ? '1' : '0',
          isSlowed: track.isSlowed ? '1' : '0'
        });
        const res = await fetch(`/api/music/url?${queryParams.toString()}`, { signal });
        if (playRequestIdRef.current !== currentRequestId) return; // Superceded by another click

        const data = await res.json();
        audioUrl = data.url;
        if ((!track.duration || track.duration === 0) && data.duration && data.duration > 0) {
          resolvedDuration = data.duration;
          setDuration(data.duration);
        }
      }

      if (playRequestIdRef.current !== currentRequestId) return;

      // Resolve picture if missing
      if (!picUrl || picUrl.startsWith('/api/music/pic')) {
        try {
          const picRes = await fetch(`/api/music/pic?id=${encodeURIComponent(String(targetId))}`, { signal });
          if (playRequestIdRef.current === currentRequestId) {
            const picData = await picRes.json();
            if (picData?.url) {
              picUrl = picData.url;
            }
          }
        } catch {}
      }

      if (playRequestIdRef.current !== currentRequestId) return;

      let playbackSuccess = false;
      if (audioUrl) {
        playbackSuccess = await applyAudioSourceAndPlay(audioUrl, currentRequestId);
      }

      // If main audio resolution failed or was empty, fall back directly to previewUrl
      if (!playbackSuccess && track.previewUrl && audioUrl !== track.previewUrl) {
        if (playRequestIdRef.current === currentRequestId) {
          audioUrl = track.previewUrl;
          playbackSuccess = await applyAudioSourceAndPlay(track.previewUrl, currentRequestId);
        }
      }

      if (playRequestIdRef.current !== currentRequestId) return;

      const finalDur = resolvedDuration || track.duration || 0;

      setCurrentTrack(prev => ({
        ...track,
        url: audioUrl,
        pic: picUrl || prev?.pic,
        duration: finalDur,
        formattedDuration: formatSeconds(finalDur)
      }));

      if (!playbackSuccess) {
        setIsLoadingAudio(false);
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        return; // Normal abort when user clicked another song
      }
      console.error('Failed to play audio:', err);
      if (playRequestIdRef.current === currentRequestId) {
        if (track.previewUrl) {
          try {
            await applyAudioSourceAndPlay(track.previewUrl, currentRequestId);
            return;
          } catch {}
        }
        setIsLoadingAudio(false);
        setIsPlaying(false);
      }
    }
  };

  const togglePlay = () => {
    if (!audioRef.current || !currentTrack) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      const currentSrc = audioRef.current.getAttribute('src');
      if (hlsRef.current || (currentSrc && currentSrc.trim() !== '' && audioRef.current.src !== window.location.href)) {
        audioRef.current.play().catch((err) => {
          console.warn('Playback resume failed, replaying track...', err);
          playTrack(currentTrack);
        });
      } else {
        playTrack(currentTrack);
      }
    }
  };

  const stopMusic = () => {
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.removeAttribute('src');
    }
    setIsPlaying(false);
    setCurrentTrack(null);
    setCurrentTime(0);
    setDuration(0);
    setLyrics('');
    setCurrentLyricLine('');
    storage.removeItem('app-music-current-track');
  };

  const currentIndex = currentTrack && playlist.length > 0
    ? playlist.findIndex(t => String(t.id) === String(currentTrack.id))
    : -1;

  return (
    <MusicContext.Provider
      value={{
        currentTrack,
        isPlaying,
        playlist,
        currentIndex,
        volume,
        currentTime,
        duration,
        isLoadingAudio,
        isRepeating,
        lyrics,
        currentLyricLine,
        isMusicOpen,
        playTrack,
        togglePlay,
        stopMusic,
        nextTrack,
        prevTrack,
        toggleRepeat,
        setVolume,
        seek,
        setIsMusicOpen,
        setPlaylist
      }}
    >
      {children}
    </MusicContext.Provider>
  );
}

export function useMusic() {
  const context = useContext(MusicContext);
  if (!context) {
    throw new Error('useMusic must be used within a MusicProvider');
  }
  return context;
}

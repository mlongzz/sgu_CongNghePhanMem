import type { Language } from '../data/places';
import { speechConfig } from './speechConfig';
import { splitSpeechText } from './speechText';

export type SpeechState = {
  id: string | null;
  status: 'idle' | 'loading' | 'playing' | 'paused';
  error: string;
};
export type PlayerState = SpeechState;
export type SpeechVoice = { identifier: string; language: string };
export type SpeechUtteranceOptions = {
  language: string; voice: string; rate: number; pitch: number; volume: number;
  onStart: () => void; onDone: () => void; onStopped: () => void;
  onError: (error?: unknown) => void; onPause: () => void; onResume: () => void;
};
export type SpeechDriver = {
  maxSpeechInputLength: number;
  getAvailableVoicesAsync: () => Promise<SpeechVoice[]>;
  speak: (text: string, options: SpeechUtteranceOptions) => void;
  stop: () => Promise<void>;
  pause?: () => Promise<void>;
  resume?: () => Promise<void>;
};
type PlayerOptions = {
  onProgress?: (id: string, progress: number) => void;
  voiceTimeoutMs?: number;
  startTimeoutMs?: number;
  stopTimeoutMs?: number;
  voiceRetryDelayMs?: number;
};
const locales: Record<Language, string> = { vi: 'vi-VN', en: 'en-US', fr: 'fr-FR', ja: 'ja-JP' };
const languageNames: Record<Language, string> = { vi: 'tiếng Việt', en: 'tiếng Anh', fr: 'tiếng Pháp', ja: 'tiếng Nhật' };
const idle = (error = ''): SpeechState => ({ id: null, status: 'idle', error });

/** One player owns the device speech queue. All asynchronous work belongs to a sequence. */
export function createSpeechPlayer(
  driver: SpeechDriver,
  platform: string,
  onState: (state: SpeechState) => void,
  options: PlayerOptions = {},
) {
  let state = idle();
  let sequence = 0;
  let disposed = false;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  let stopQueue = Promise.resolve();
  let pendingChunk: (() => void) | null = null;
  const active = (current: number) => !disposed && current === sequence;
  const emit = (next: SpeechState) => { state = next; if (!disposed) onState({ ...next }); };
  const clearWatchdog = () => { if (watchdog !== undefined) clearTimeout(watchdog); watchdog = undefined; };
  const withTimeout = <T>(task: Promise<T>, ms: number, message: string): Promise<T> => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    task.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
  // Serializing stop is essential: a slow stop from an old tap must never cancel a newer utterance.
  const queueStop = () => {
    const next = stopQueue.then(() => driver.stop());
    stopQueue = next.catch(() => {});
    return next;
  };
  const fail = (current: number, message: string) => {
    if (!active(current)) return;
    sequence++;
    clearWatchdog();
    pendingChunk = null;
    emit(idle(message));
    void queueStop().catch(() => {});
  };
  const stop = () => {
    sequence++;
    clearWatchdog();
    pendingChunk = null;
    emit(idle());
    void queueStop().catch(() => {});
  };
  const play = async (text: string, language: Language, rate: number, id: string): Promise<void> => {
    if (disposed) return;
    const current = ++sequence;
    clearWatchdog();
    pendingChunk = null;
    emit({ id, status: 'loading', error: '' });
    try {
      await withTimeout(queueStop(), options.stopTimeoutMs ?? 4000, 'Thiết bị chưa dừng được giọng đọc cũ. Hãy thử lại.');
      if (!active(current)) return;
      if (!text.trim()) throw new Error('Địa danh này chưa có nội dung thuyết minh. Vui lòng thử lại sau.');
      if (!locales[language] || !Number.isFinite(rate) || rate < 0.1 || rate > 2) throw new Error('Ngôn ngữ hoặc tốc độ đọc không hợp lệ.');
      let voices = await withTimeout(driver.getAvailableVoicesAsync(), options.voiceTimeoutMs ?? 7000,
        'Thiết bị chưa tải được danh sách giọng đọc. Kiểm tra giọng nói đã cài và bấm nghe để thử lại.');
      // Browsers may initially report an empty list while their voice service starts.
      for (let retry = 0; platform === 'web' && voices.length === 0 && retry < 2 && active(current); retry++) {
        await new Promise(resolve => setTimeout(resolve, options.voiceRetryDelayMs ?? 250));
        if (!active(current)) return;
        voices = await withTimeout(driver.getAvailableVoicesAsync(), options.voiceTimeoutMs ?? 7000,
          'Thiết bị chưa tải được danh sách giọng đọc. Hãy bấm nghe để thử lại.');
      }
      if (!active(current)) return;
      const normalized = (value: string) => value.toLowerCase().replace(/_/g, '-');
      const locale = locales[language];
      const usable = voices.filter(voice => typeof voice.identifier === 'string' && voice.identifier && typeof voice.language === 'string');
      const voice = usable.find(item => normalized(item.language) === normalized(locale))
        ?? usable.find(item => normalized(item.language).split('-')[0] === language);
      if (!voice) throw new Error(`Thiết bị chưa có giọng đọc ${languageNames[language]}. Hãy cài giọng nói cho ngôn ngữ này, rồi bấm nghe để thử lại.`);
      const deviceLimit = Number.isFinite(driver.maxSpeechInputLength) ? Math.floor(driver.maxSpeechInputLength) : 750;
      const chunks = splitSpeechText(text, Math.min(750, deviceLimit));
      const playChunk = (index: number) => {
        if (!active(current)) return;
        if (index >= chunks.length) { emit(idle()); return; }
        if (state.status === 'paused') { pendingChunk = () => playChunk(index); return; }
        let finished = false;
        const live = () => active(current) && !finished;
        clearWatchdog();
        emit({ id, status: 'loading', error: '' });
        watchdog = setTimeout(() => fail(current,
          'Giọng đọc chưa bắt đầu. Hãy bấm nghe lại, kiểm tra âm lượng và cho phép trình duyệt phát âm thanh.'), options.startTimeoutMs ?? 10000);
        try {
          driver.speak(chunks[index], {
            language: voice.language || locale, voice: voice.identifier, rate, pitch: speechConfig.pitch, volume: 1,
            onStart: () => { if (live()) { clearWatchdog(); emit({ id, status: 'playing', error: '' }); } },
            onDone: () => {
              if (!live()) return;
              finished = true;
              clearWatchdog();
              options.onProgress?.(id, (index + 1) / chunks.length);
              playChunk(index + 1);
            },
            onStopped: () => {
              if (live() && state.status !== 'paused') { finished = true; clearWatchdog(); emit(idle()); }
            },
            onError: () => { if (live()) fail(current, 'Không phát được giọng đọc. Hãy kiểm tra âm lượng, giọng nói đã cài và chế độ im lặng trên iPhone, rồi thử lại.'); },
            onPause: () => { if (live()) emit({ id, status: 'paused', error: '' }); },
            onResume: () => { if (live()) emit({ id, status: 'playing', error: '' }); },
          });
        } catch (error) {
          fail(current, error instanceof Error ? error.message : 'Không thể phát giọng đọc. Hãy thử lại.');
        }
      };
      playChunk(0);
    } catch (error) {
      fail(current, error instanceof Error ? error.message : 'Không thể phát giọng đọc. Hãy thử lại.');
    }
  };
  const pause = async () => {
    if (disposed || state.status !== 'playing' || platform === 'android' || !driver.pause) return;
    const current = sequence;
    const previous = state;
    emit({ ...state, status: 'paused' });
    try { await driver.pause(); }
    catch { if (active(current)) emit({ ...previous, error: 'Không thể tạm dừng trên thiết bị này. Bạn có thể dừng và nghe lại.' }); }
  };
  const resume = async () => {
    if (disposed || state.status !== 'paused' || platform === 'android' || !driver.resume) return;
    const current = sequence;
    try {
      await driver.resume();
      if (!active(current)) return;
      emit({ ...state, status: 'playing' });
      const next = pendingChunk;
      pendingChunk = null;
      next?.();
    } catch { if (active(current)) emit({ ...state, error: 'Không thể tiếp tục. Hãy dừng và nghe lại.' }); }
  };
  const dispose = () => {
    disposed = true;
    sequence++;
    clearWatchdog();
    pendingChunk = null;
    void queueStop().catch(() => {});
  };
  return { play, stop, pause, resume, dispose };
}

/**
 * Expo 57 web treats the browser pause event as stopped and unregisters callbacks.
 * This adapter preserves the real pause/resume/end events and checks cancellation
 * synchronously, so resumed long guides continue through every chunk.
 */
export function createWebSpeechDriver(): SpeechDriver {
  let current: SpeechSynthesisUtterance | null = null;
  const synth = () => {
    if (typeof window === 'undefined' || !window.speechSynthesis || typeof SpeechSynthesisUtterance === 'undefined') {
      throw new Error('Trình duyệt này chưa hỗ trợ đọc thuyết minh. Hãy mở bằng Chrome hoặc Edge có giọng nói đã cài.');
    }
    return window.speechSynthesis;
  };
  return {
    maxSpeechInputLength: 32767,
    getAvailableVoicesAsync: async () => synth().getVoices().map(voice => ({ identifier: voice.voiceURI, language: voice.lang })),
    speak(text, options) {
      const synthesis = synth();
      const voice = synthesis.getVoices().find(item => item.voiceURI === options.voice && item.lang.toLowerCase() === options.language.toLowerCase());
      if (!voice) throw new Error('Giọng đọc đã thay đổi hoặc bị gỡ. Hãy chọn lại ngôn ngữ và bấm nghe.');
      const utterance = new SpeechSynthesisUtterance(text);
      current = utterance;
      utterance.voice = voice;
      utterance.lang = options.language;
      utterance.rate = options.rate;
      utterance.pitch = options.pitch;
      utterance.volume = options.volume;
      utterance.onstart = () => { if (current === utterance) options.onStart(); };
      utterance.onpause = () => { if (current === utterance) options.onPause(); };
      utterance.onresume = () => { if (current === utterance) options.onResume(); };
      utterance.onend = () => { if (current === utterance) { current = null; options.onDone(); } };
      utterance.onerror = event => { if (current === utterance) { current = null; options.onError(event); } };
      synthesis.speak(utterance);
    },
    stop: async () => { current = null; synth().cancel(); },
    pause: async () => synth().pause(),
    resume: async () => synth().resume(),
  };
}

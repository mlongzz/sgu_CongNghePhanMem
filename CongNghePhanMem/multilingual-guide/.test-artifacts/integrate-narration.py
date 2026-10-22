from pathlib import Path
p = Path('src/context/AppContext.tsx')
s = p.read_text(encoding='utf-8')
start = s.index('  const stop = useCallback(() => {')
end = s.index('  const refreshNearby = useCallback', start)
s = s[:start] + '''  const speechState = useRef<PlayerState>({ id: null, status: 'idle', error: '' });
  const audioSession = useRef<{ id: string; token: string; session: Promise<number | null> } | null>(null);
  const getPlayer = useCallback(() => {
    if (!player.current) player.current = createSpeechPlayer(
      Platform.OS === 'web' ? createWebSpeechDriver() : Speech,
      Platform.OS,
      state => { speechState.current = state; setPlayingId(state.id); setSpeechStatus(state.status); setSpeechError(state.error); },
      (id, progress) => {
        const saved = audioSession.current;
        if (saved?.id === id) void saved.session.then(sessionId => sessionId && apiFetch(`/audio-sessions/${sessionId}`, {
          token: saved.token, method: 'PATCH', body: JSON.stringify({ progress, completed: progress === 1 }),
        })).catch(() => {});
      },
    );
    return player.current;
  }, []);
  const stop = useCallback(() => {
    speechSeq.current++;
    speechRequest.current?.abort();
    speechRequest.current = null;
    player.current?.stop();
    setPlayingId(null); setSpeechStatus('idle');
  }, []);
  const setSpeechRate = useCallback((rate: number) => {
    if (![0.75, 1, 1.25, 1.5].includes(rate)) return;
    stop(); saveSpeechRate(rate);
  }, [stop]);
  const pauseSpeech = useCallback(() => { void player.current?.pause(); }, []);
  const resumeSpeech = useCallback(() => { void player.current?.resume(); }, []);
  const speak = useCallback(async (p: Place, supplied?: NarrationContent): Promise<boolean> => {
    if (speechState.current.id === p.id || (playingId === p.id && speechStatus === 'loading')) { stop(); return false; }
    const current = ++speechSeq.current;
    speechRequest.current?.abort();
    const controller = new AbortController();
    speechRequest.current = controller;
    getPlayer().stop();
    setPlayingId(p.id); setSpeechStatus('loading'); setSpeechError('');
    try {
      const content = supplied?.language === language ? supplied : await resolveNarration(p, language, { signal: controller.signal, officialPlaces: places });
      if (controller.signal.aborted || current !== speechSeq.current) return false;
      if (!content?.text.trim()) throw new Error(NO_NARRATION + ' Hãy chọn ngôn ngữ khác nếu có.');
      audioSession.current = null;
      if (/^db-\\d+$/.test(p.id) && content.source === 'published' && token) {
        audioSession.current = { id: p.id, token, session: apiFetch<{id:number}>('/audio-sessions', {
          token, method: 'POST', body: JSON.stringify({ place_id: Number(p.id.slice(3)), language_code: language }),
        }).then(result => result.id).catch(() => null) };
      }
      await getPlayer().play(content.text, language, speechRate, p.id);
      return current === speechSeq.current && !speechState.current.error;
    } catch (e) {
      if (current === speechSeq.current && !controller.signal.aborted) {
        setPlayingId(null); setSpeechStatus('idle'); setSpeechError(e instanceof Error ? e.message : 'Không thể phát tiếng.');
      }
      return false;
    }
  }, [language, speechRate, token, places, playingId, speechStatus, stop, getPlayer]);
  const testSpeech = useCallback(() => {
    stop();
    const greetings: Record<Language, string> = {
      vi: 'Xin chào. Đây là kiểm tra giọng đọc của ứng dụng Multilingual Guide.',
      en: 'Hello. This is a voice test for Multilingual Guide.',
      fr: 'Bonjour. Ceci est un test vocal de Multilingual Guide.',
      ja: 'こんにちは。マルチリンガルガイドの音声テストです。',
    };
    void getPlayer().play(greetings[language], language, speechRate, 'speech-test');
  }, [language, speechRate, stop, getPlayer]);
''' + s[end:]
start=s.index('  const findPlace = useCallback(')
end=s.index('  const saveDraft = useCallback',start)
s=s[:start]+'''  const registerPlace = useCallback((place: Place) => {
    selectedPlaces.current.delete(place.id);
    selectedPlaces.current.set(place.id, place);
    if (selectedPlaces.current.size > 20) selectedPlaces.current.delete(selectedPlaces.current.keys().next().value!);
    setRegisteredVersion(v => v + 1);
    void AsyncStorage.setItem(STORE_DISCOVERED, JSON.stringify([...selectedPlaces.current.values()])).catch(() => {});
  }, []);
  useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(STORE_DISCOVERED).then(raw => {
      if (!active || !raw) return;
      const rows: unknown = JSON.parse(raw);
      if (Array.isArray(rows)) for (const value of rows.slice(-20)) {
        if (!value || typeof value !== 'object') continue;
        const p = value as Place;
        if (typeof p.id !== 'string' || !/^(wiki-(vi|en|fr|ja)-\\d+|osm-(node|way|relation)-\\d+|db-\\d+)$/.test(p.id) ||
          typeof p.title !== 'string' || !p.subtitle || !p.description ||
          !Number.isFinite(p.latitude) || Math.abs(p.latitude) > 90 || !Number.isFinite(p.longitude) || Math.abs(p.longitude) > 180) continue;
        if (!selectedPlaces.current.has(p.id)) selectedPlaces.current.set(p.id, p);
      }
      if (active) setRegisteredVersion(v => v + 1);
    }).catch(() => {});
    return () => { active = false; };
  }, []);
  const findPlace = useCallback((id: string) => places.find(p => p.id === id) ?? selectedPlaces.current.get(id), [places, registeredVersion]);
''' + s[end:]
# Expose the new controls without disrupting existing consumers.
s=s.replace('      speechError,\n      speak,','      speechError, speechStatus, speechRate, setSpeechRate, pauseSpeech, resumeSpeech,\n      canPauseSpeech: Platform.OS !== "android",\n      speak,',1)
s=s.replace('      speechError,\n      speak,','      speechError, speechStatus, speechRate, setSpeechRate, pauseSpeech, resumeSpeech,\n      speak,',1)
s=s.replace('      findPlace,\n      drafts,','      findPlace, registerPlace,\n      drafts,')
p.write_text(s,encoding='utf-8')

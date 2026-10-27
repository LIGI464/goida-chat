import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  MODES,
  fileCapable,
  resources,
  type ModeId,
} from '../../features/voice/audio/noiseLabAdapters';
import {
  decodeFixture,
  runAndRelease,
  type Fixture,
  type FixtureKind,
  type RunResult,
} from '../../features/voice/audio/noiseLabRunner';

const button = 'brand-button brand-button-secondary px-4 py-2 disabled:opacity-40';
const kinds: Record<FixtureKind, string> = {
  speech: 'Только речь',
  keyboard: 'Только клавиатура',
  fan: 'Только вентилятор',
  music: 'Только музыка',
  mixed: 'Речь с шумом',
  synthetic: 'Синтетический сигнал',
};
type Review = {
  speech: number | null;
  keyboard: number | null;
  fan: number | null;
  music: number | null;
  cpu: number | null;
  notes: string;
};
type Row = { id: number; label: string; status: string; result?: RunResult; review: Review };
const emptyReview = (): Review => ({
  speech: null,
  keyboard: null,
  fan: null,
  music: null,
  cpu: null,
  notes: '',
});
type Stability = {
  requested: number;
  completed: number;
  mode: ModeId;
  hash: string;
  status: string;
  peakDenoisers: number;
  peakContexts: number;
  elapsedMs: number;
  after: typeof resources;
};
const number = (value: number | null | undefined, unit = '') =>
  value == null ? 'не измерено' : `${value.toFixed(2)}${unit}`;

function AudioClip({ blob, title }: { blob: Blob; title: string }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return (
    <div className="grid gap-2">
      <span>{title}</span>
      <audio aria-label={title} controls preload="none" src={url} className="max-w-full" />
      <a download={`${title}.wav`} href={url} className="underline">
        Скачать WAV
      </a>
    </div>
  );
}

export function NoiseSuppressionLab() {
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [kind, setKind] = useState<FixtureKind>('mixed');
  const [source, setSource] = useState<'file' | 'microphone'>('file');
  const [modeId, setModeId] = useState<ModeId>('raw');
  const [deviceId, setDeviceId] = useState('');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [stability, setStability] = useState<Stability[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('Готово к тестированию');
  const [error, setError] = useState('');
  const operation = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const nextId = useRef(1);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      operation.current?.abort();
    };
  }, []);

  async function operate(task: (signal: AbortSignal) => Promise<void>) {
    if (operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setError('');
    try {
      await task(controller.signal);
    } catch (caught) {
      if (mounted.current)
        setError(
          controller.signal.aborted
            ? 'Остановлено. Ресурсы освобождены.'
            : caught instanceof Error
              ? caught.message
              : String(caught),
        );
    } finally {
      operation.current = null;
      if (mounted.current) {
        setBusy(false);
        setProgress('Готово');
      }
    }
  }

  async function addFiles(files: File[]) {
    await operate(async (signal) => {
      if (fixtures.length + files.length > 8)
        throw new Error('За один набор можно загрузить до 8 записей.');
      const decoded: Fixture[] = [];
      for (const file of files) {
        signal.throwIfAborted();
        decoded.push(await decodeFixture(file, kind));
      }
      signal.throwIfAborted();
      setFixtures((current) => [...current, ...decoded]);
    });
  }

  async function recordReference() {
    await operate(async (signal) => {
      setProgress('Записываю 8 секунд raw-микрофона…');
      const result = await runAndRelease(
        MODES[0],
        { type: 'microphone', deviceId, seconds: 8 },
        signal,
      );
      const fixture = await decodeFixture(
        new File([result.inputWav], `microphone-${Date.now()}.wav`),
        kind,
      );
      signal.throwIfAborted();
      setFixtures((current) => [...current, fixture]);
    });
  }

  async function compare(all: boolean) {
    await operate(async (signal) => {
      const selected = all ? MODES : MODES.filter((mode) => mode.id === modeId);
      const inputs =
        source === 'file'
          ? fixtures.map((fixture) => ({ type: 'file' as const, fixture }))
          : [{ type: 'microphone' as const, deviceId, seconds: 8 }];
      if (!inputs.length) throw new Error('Сначала загрузите или запишите эталон.');
      if (rows.length + inputs.length * selected.length > 128)
        throw new Error('Экспортируйте результаты и очистите набор: лимит 128 строк.');
      for (const input of inputs)
        for (const mode of selected) {
          signal.throwIfAborted();
          const label = `${mode.label} · ${input.type === 'file' ? input.fixture.name : 'микрофон'}`;
          setProgress(label);
          const row: Row = { id: nextId.current++, label, status: 'ok', review: emptyReview() };
          if (input.type === 'file' && !fileCapable(mode)) {
            row.status = 'Пропущено: NS/AGC/AEC требуют захвата микрофона или виртуального входа.';
          } else {
            try {
              row.result = await runAndRelease(mode, input, signal);
            } catch (caught) {
              signal.throwIfAborted();
              row.status = caught instanceof Error ? caught.message : String(caught);
            }
          }
          signal.throwIfAborted();
          setRows((current) => [...current, row]);
        }
    });
  }

  async function stress(cycles: number) {
    await operate(async (signal) => {
      const fixture = fixtures[0];
      if (!fixture && source === 'file') throw new Error('Нужен эталонный файл.');
      const mode = MODES.find((item) => item.id === modeId)!;
      const input =
        source === 'file'
          ? { type: 'file' as const, fixture: fixture! }
          : { type: 'microphone' as const, deviceId, seconds: 1 };
      const report: Stability = {
        requested: cycles,
        completed: 0,
        mode: modeId,
        hash: input.type === 'file' ? input.fixture.hash : 'live microphone',
        status: 'running',
        peakDenoisers: 0,
        peakContexts: 0,
        elapsedMs: 0,
        after: { ...resources },
      };
      const start = performance.now();
      try {
        for (let i = 0; i < cycles; i++) {
          signal.throwIfAborted();
          setProgress(`${mode.label}: цикл ${i + 1}/${cycles}`);
          const result = await runAndRelease(mode, input, signal);
          if (result.metrics.inputDbfs === null)
            throw new Error('Нет входного сигнала; цикл не засчитан.');
          if (
            input.type === 'file' &&
            fixture?.kind === 'synthetic' &&
            result.metrics.outputSilent &&
            mode.dsp !== 'gate'
          )
            throw new Error('Неожиданный нулевой выход.');
          report.completed++;
          report.peakDenoisers = Math.max(report.peakDenoisers, result.peakResources.denoisers);
          report.peakContexts = Math.max(report.peakContexts, result.peakResources.contexts);
        }
        report.status = 'passed';
      } catch (caught) {
        report.status = signal.aborted
          ? 'cancelled'
          : caught instanceof Error
            ? caught.message
            : String(caught);
        throw caught;
      } finally {
        report.elapsedMs = performance.now() - start;
        report.after = { ...resources };
        if (mounted.current) setStability((current) => [...current, report]);
      }
    });
  }

  function exportReport() {
    const report = {
      schema: 1,
      exportedAt: new Date().toISOString(),
      userAgent: navigator.userAgent,
      hardwareConcurrency: navigator.hardwareConcurrency,
      method:
        '48kHz mono; single DSP; waveform lag (0–200ms, correlation >= .5), not end-to-end; CPU and listening scores entered manually; live captures are not identical replay; energy reduction is not speech quality',
      fixtures: fixtures.map(({ pcm, ...fixture }) => ({
        ...fixture,
        seconds: pcm.length / 48000,
      })),
      rows: rows.map(({ result, ...row }) => ({
        ...row,
        result: result ? { ...result, inputWav: undefined, outputWav: undefined } : null,
      })),
      stability,
      resources: { ...resources },
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'noise-lab-report.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <main className="h-dvh overflow-y-auto p-4 md:p-8">
      <div className="mx-auto grid max-w-6xl gap-6">
        <header className="flex flex-wrap justify-between gap-4">
          <div>
            <p className="brand-eyebrow text-xs text-[var(--muted)]">Audio laboratory</p>
            <h1 className="brand-display mt-2 text-3xl">Сравнение шумоподавления</h1>
            <p className="mt-3 text-[var(--muted)]">
              Отдельная лаборатория. Настройки звонков и основной default не меняются.
            </p>
          </div>
          <Link className={button} to="/app">
            В приложение
          </Link>
        </header>
        <section className="brand-card grid gap-4 p-5">
          <h2 className="brand-display text-xl">1. Источник и эталоны</h2>
          <p className="text-sm text-[var(--muted)]">
            Для оценки помех загрузите отдельные записи речи, клавиатуры, вентилятора и музыки; для
            прослушивания — речь с шумом. Один файл будет повторён без изменений во всех совместимых
            режимах. 1–20 секунд, до 20 MB.
          </p>
          <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-2">
              Источник
              <select
                className="brand-input p-2"
                value={source}
                onChange={(e) => setSource(e.target.value as typeof source)}
              >
                <option value="file">Одинаковые файлы</option>
                <option value="microphone">Микрофон / виртуальный вход (8 с)</option>
              </select>
            </label>
            <label className="grid gap-2">
              Категория новых записей
              <select
                className="brand-input p-2"
                value={kind}
                onChange={(e) => setKind(e.target.value as FixtureKind)}
              >
                {Object.entries(kinds).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-2">
              Загрузить эталоны
              <input
                type="file"
                accept="audio/*"
                multiple
                onChange={(e) => {
                  void addFiles(Array.from(e.target.files ?? []));
                  e.target.value = '';
                }}
              />
            </label>
            <label className="grid gap-2">
              Вход
              <select
                className="brand-input p-2"
                value={deviceId}
                onChange={(e) => setDeviceId(e.target.value)}
              >
                <option value="">Системный микрофон</option>
                {devices.map((device) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label || `Вход ${device.deviceId.slice(0, 8)}`}
                  </option>
                ))}
              </select>
            </label>
          </fieldset>
          <div className="flex flex-wrap gap-3">
            <button
              className={button}
              disabled={busy}
              onClick={() =>
                void operate(async () => {
                  setDevices(
                    (await navigator.mediaDevices.enumerateDevices()).filter(
                      (device) => device.kind === 'audioinput',
                    ),
                  );
                })
              }
            >
              Обновить входы
            </button>
            <button
              className={button}
              disabled={busy || fixtures.length >= 8}
              onClick={() => void recordReference()}
            >
              Записать raw-эталон, 8 с
            </button>
            <button
              className={button}
              disabled={busy}
              onClick={() => {
                setFixtures([]);
                setRows([]);
                setStability([]);
              }}
            >
              Очистить набор
            </button>
          </div>
          <ul className="grid gap-2 text-sm">
            {fixtures.map((fixture, index) => (
              <li key={`${fixture.hash}-${index}`}>
                {fixture.name} · {kinds[fixture.kind]} · {(fixture.pcm.length / 48000).toFixed(1)} с
                · SHA-256 {fixture.hash.slice(0, 12)}
              </li>
            ))}
          </ul>
          <p className="text-sm text-[var(--warning)]">
            Browser NS/AGC/AEC нельзя применить к файлу через Web Audio. Для их сравнения
            воспроизводите тот же эталон в виртуальный микрофон и запускайте каждый режим отдельно.
            Живые записи помечаются как несинхронные и не считаются идентичным повтором. AEC
            дополнительно требует реального эхо-тракта.
          </p>
        </section>
        <section className="brand-card grid gap-4 p-5">
          <h2 className="brand-display text-xl">2. Режим и запуск</h2>
          <label className="grid gap-2">
            Режим
            <select
              disabled={busy}
              className="brand-input p-2"
              value={modeId}
              onChange={(e) => setModeId(e.target.value as ModeId)}
            >
              {MODES.map((mode) => (
                <option key={mode.id} value={mode.id}>
                  {mode.label} · NS {Number(mode.ns)} / AGC {Number(mode.agc)} / AEC{' '}
                  {Number(mode.aec)}
                </option>
              ))}
            </select>
          </label>
          <p className="text-sm text-[var(--muted)]">
            Experimental — один noise gate: −35/−40 dB, hold 150 ms. RNNoise + AEC — отдельный
            вариант захвата без browser NS/AGC. GTCRN не подключён.
          </p>
          <div className="flex flex-wrap gap-3">
            <button className={button} disabled={busy} onClick={() => void compare(false)}>
              Выбранный режим
            </button>
            <button
              className={button}
              disabled={busy || source !== 'file'}
              onClick={() => void compare(true)}
            >
              Сравнить все на файлах
            </button>
            <button className={button} disabled={busy} onClick={() => void stress(50)}>
              50 циклов
            </button>
            <button className={button} disabled={busy} onClick={() => void stress(100)}>
              100 циклов
            </button>
            <button className={button} disabled={!busy} onClick={() => operation.current?.abort()}>
              Остановить
            </button>
          </div>
          <p role="status">{progress}</p>
          {error && (
            <p role="alert" className="text-[var(--danger)]">
              {error}
            </p>
          )}
          <p className="text-sm text-[var(--muted)]">
            Циклы полностью воспроизводят первый эталон (микрофон: 1 с на цикл) и закрывают
            AudioContext. Счётчики принадлежат лаборатории; они не заменяют проверку памяти
            браузера.
          </p>
          {stability.map((item, index) => (
            <p key={index} className="text-sm">
              {item.mode}: {item.completed}/{item.requested}, {item.status}; peak DSP{' '}
              {item.peakDenoisers}, contexts {item.peakContexts}; после:{' '}
              {JSON.stringify(item.after)}
            </p>
          ))}
        </section>
        <section className="grid gap-4">
          <div className="flex flex-wrap justify-between gap-3">
            <h2 className="brand-display text-xl">3. Результаты и прослушивание</h2>
            <button
              className={button}
              disabled={busy || (!rows.length && !stability.length)}
              onClick={exportReport}
            >
              Экспорт JSON
            </button>
          </div>
          <p className="text-sm text-[var(--muted)]">
            Речь: вручную 0–100 (100 — полностью сохранена). Остаточные помехи: 0–100 (0 — не
            слышны). CPU: средний % из профилировщика браузера/ОС с указанной методикой. Пустое поле
            означает «не измерено». Задержка — оценка DSP по форме сигнала, без задержки устройства
            и браузерного захвата.
          </p>
          {rows.map((row) => (
            <article key={row.id} className="brand-card grid gap-4 p-5">
              <h3 className="brand-display text-lg">{row.label}</h3>
              {row.status !== 'ok' ? (
                <p>{row.status}</p>
              ) : (
                row.result && (
                  <>
                    <div className="grid gap-2 text-sm sm:grid-cols-2">
                      <p>
                        DSP-задержка: {number(row.result.metrics.lag?.ms, ' ms')} · корреляция{' '}
                        {number(row.result.metrics.lag?.confidence)}
                      </p>
                      <p>
                        Уровень выхода: {number(row.result.metrics.outputDbfs, ' dBFS')}
                        {row.result.metrics.outputSilent ? ' · тишина (не оценка качества)' : ''}
                      </p>
                      <p>
                        Снижение энергии в DSP: {number(row.result.metrics.attenuationDb, ' dB')} ·{' '}
                        {kinds[row.result.kind]}; вход уже после browser capture, это не сохранение
                        речи
                      </p>
                      <p>
                        DSP {row.result.peakResources.denoisers} · recorder{' '}
                        {row.result.peakResources.recorders} · context{' '}
                        {row.result.peakResources.contexts} · после{' '}
                        {JSON.stringify(row.result.afterResources)}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-5">
                      <AudioClip blob={row.result.inputWav} title={`Вход-${row.id}`} />
                      <AudioClip blob={row.result.outputWav} title={`Выход-${row.id}`} />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-5">
                      {(['speech', 'keyboard', 'fan', 'music', 'cpu'] as const).map((field) => (
                        <label key={field} className="grid gap-1 text-sm">
                          {
                            {
                              speech: 'Сохранение речи',
                              keyboard: 'Клавиатура',
                              fan: 'Вентилятор',
                              music: 'Музыка',
                              cpu: 'CPU, % (вручную)',
                            }[field]
                          }
                          <input
                            className="brand-input w-full p-2"
                            type="number"
                            min={0}
                            max={field === 'cpu' ? undefined : 100}
                            step="0.1"
                            value={row.review[field] ?? ''}
                            onChange={(e) => {
                              const value =
                                e.target.value === ''
                                  ? null
                                  : Math.max(
                                      0,
                                      Math.min(
                                        field === 'cpu' ? Infinity : 100,
                                        Number(e.target.value),
                                      ),
                                    );
                              setRows((current) =>
                                current.map((item) =>
                                  item.id === row.id
                                    ? { ...item, review: { ...item.review, [field]: value } }
                                    : item,
                                ),
                              );
                            }}
                          />
                        </label>
                      ))}
                    </div>
                    <label className="grid gap-2 text-sm">
                      Методика CPU, устройство, условия, артефакты речи
                      <textarea
                        className="brand-input p-2"
                        value={row.review.notes}
                        onChange={(e) =>
                          setRows((current) =>
                            current.map((item) =>
                              item.id === row.id
                                ? { ...item, review: { ...item.review, notes: e.target.value } }
                                : item,
                            ),
                          )
                        }
                      />
                    </label>
                  </>
                )
              )}
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}

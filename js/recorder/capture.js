// Microphone capture via AudioWorklet (true PCM, no MediaRecorder codec). AGC, noise suppression and echo cancellation off.
// UNTESTED on iPad Safari and with a real voice.
import { SAMPLE_RATE } from '../config.js';

export class MicDeniedError extends Error { constructor(e) { super('Microphone permission denied'); this.name = 'MicDeniedError'; this.cause = e; } }

export async function openMic({ onChunk, onLost, deviceId } = {}) {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: {
      channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false,
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}) } });
  } catch (e) {
    if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) throw new MicDeniedError(e);
    throw e;
  }
  let ctx, source;
  try { ctx = new AudioContext({ sampleRate: SAMPLE_RATE }); source = ctx.createMediaStreamSource(stream); }
  catch { try { ctx && ctx.close(); } catch {} ctx = new AudioContext(); source = ctx.createMediaStreamSource(stream); }
  await ctx.audioWorklet.addModule(new URL('./capture-worklet.js', import.meta.url));
  const node = new AudioWorkletNode(ctx, 'kjv-capture', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: 'explicit' });
  const mute = ctx.createGain(); mute.gain.value = 0; // keep the graph pulled without sending the mic to the speakers
  source.connect(node); node.connect(mute); mute.connect(ctx.destination);
  node.port.onmessage = e => onChunk && onChunk(e.data);
  let lost = false;
  const lose = why => { if (!lost) { lost = true; onLost && onLost(why); } };
  for (const t of stream.getAudioTracks()) { t.onended = () => lose('track ended'); t.onmute = () => lose('track muted'); }
  ctx.onstatechange = () => { if (ctx.state === 'interrupted' || ctx.state === 'closed') lose(`audio ${ctx.state}`); };
  if (ctx.state === 'suspended') await ctx.resume();
  return {
    sampleRate: ctx.sampleRate, ctx, stream,
    flush() { node.port.postMessage('flush'); },
    async close() { lost = true; try { stream.getTracks().forEach(t => t.stop()); } catch {} try { await ctx.close(); } catch {} },
  };
}

/** If the device would not run at 48 kHz, convert with the browser's own resampler (not bit-exact; flagged in take meta). */
export async function resampleTo(samples, fromRate, toRate = SAMPLE_RATE) {
  if (fromRate === toRate) return samples;
  const len = Math.ceil(samples.length * toRate / fromRate);
  const oc = new OfflineAudioContext(1, len, toRate);
  const b = oc.createBuffer(1, samples.length, fromRate); b.copyToChannel(samples, 0);
  const src = oc.createBufferSource(); src.buffer = b; src.connect(oc.destination); src.start();
  return (await oc.startRendering()).getChannelData(0).slice();
}

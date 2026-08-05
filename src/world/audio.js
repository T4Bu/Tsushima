export function createWindAudio() {
  let context = null;
  let master = null;
  let windGain = null;
  let rustleGain = null;
  let started = false;

  function makeNoiseBuffer(seconds = 5) {
    const length = Math.floor(context.sampleRate * seconds);
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      last = last * .985 + white * .015;
      data[i] = white * .42 + last * 2.4;
    }
    return buffer;
  }

  async function start() {
    if (started) {
      await context?.resume();
      return;
    }
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    context = new AudioContext();
    master = context.createGain();
    master.gain.value = .18;
    master.connect(context.destination);

    const wind = context.createBufferSource();
    wind.buffer = makeNoiseBuffer(7);
    wind.loop = true;
    const windFilter = context.createBiquadFilter();
    windFilter.type = 'lowpass';
    windFilter.frequency.value = 520;
    windFilter.Q.value = .35;
    windGain = context.createGain();
    windGain.gain.value = .10;
    wind.connect(windFilter).connect(windGain).connect(master);

    const rustle = context.createBufferSource();
    rustle.buffer = makeNoiseBuffer(4.2);
    rustle.loop = true;
    const rustleFilter = context.createBiquadFilter();
    rustleFilter.type = 'bandpass';
    rustleFilter.frequency.value = 2350;
    rustleFilter.Q.value = .55;
    rustleGain = context.createGain();
    rustleGain.gain.value = .018;
    rustle.connect(rustleFilter).connect(rustleGain).connect(master);

    wind.start();
    rustle.start(.17);
    started = true;
  }

  function update(windStrength = 1, inBamboo = false) {
    if (!context || !started) return;
    const now = context.currentTime;
    windGain.gain.setTargetAtTime(.055 + windStrength * .055, now, .8);
    rustleGain.gain.setTargetAtTime((inBamboo ? .032 : .018) * windStrength, now, .38);
  }

  return { start, update };
}

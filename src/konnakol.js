// requires ohm and audio global "modules"

const konnakol = {};
konnakol.grammar = ohm.grammarFromScriptElement();
konnakol.semantics = konnakol.grammar.createSemantics();
konnakol.soundLibraries = {};

konnakol.createSoundLibrary = (lookup) => {
  if (!lookup.hasOwnProperty('default')) {
    throw Error('sound library needs to have default sounds set');
  }

  ['normal', 'stress'].forEach(type => {
    if (!lookup.default.hasOwnProperty(type)) {
      throw Error(`sound library default needs a sound for '${type}'`);
    }
  });

  return {
    get: (syllable, type) => {
      const haveSyllable = lookup.hasOwnProperty(syllable);
      const haveSound = haveSyllable && lookup[syllable].hasOwnProperty(type);

      function warning (useSyllable, useType) {
        console.log(`warning: no sound for [${syllable}][${type}] using [${useSyllable}][${useType}]`);
      }

      if (haveSound) {
        return lookup[syllable][type];
      }

      if (haveSyllable) {
        const fallbackKey = Object.keys(lookup[syllable])[0];
        // warning(syllable, fallbackKey);
        return lookup[syllable][fallbackKey];
      }

      const defaultHasType = lookup.default.hasOwnProperty(type);
      if (defaultHasType) {
        // warning('default', type);
        return lookup.default[type];
      }

      // warning('default', 'normal');
      return lookup.default['normal'];
    },
    set: (syllable, type, buffer) => lookup[syllable][type] = buffer
  };
};

konnakol.addSoundLibrary = (name, soundLibrary) => {
  konnakol.soundLibraries[name] = soundLibrary;
};

konnakol.addSoundLibraryFromLookup = (name, lookup) => {
  konnakol.addSoundLibrary(name, konnakol.createSoundLibrary(lookup));
};

konnakol.Chunk = class Chunk {
  constructor(chunks, speed, gati) {
    this.subchunks = chunks;
    this.speed = speed;
    this.setGati(gati);
  }

  setGati(gati) {
    this.gati = gati;
    if (gati !== undefined) {
      this.subchunks.forEach(subchunk => subchunk.setGati(gati));
    }
  }

  getDuration(speed) {
    const sum = this.subchunks.reduce((prev, cur) => {
      return prev + cur.getDuration(speed);
    }, 0);

    return sum / this.speed;
  }

  play(when=0, speed, soundLibrary) {
    let subchunkWhen = when;
    this.subchunks.forEach(subchunk => {
      subchunk.play(subchunkWhen, speed * this.speed, soundLibrary);
      subchunkWhen += subchunk.getDuration(this.speed) / speed;
    });
  }

  toString() {
    return this.subchunks.map(subchunk => subchunk.toString()).join(' ');
  }
};

konnakol.Word = class Word extends konnakol.Chunk {
  constructor(syllables, speed, gati) {
    syllables[0].type = 'stress';
    super(syllables, speed, gati);
  }
};

konnakol.Phrase = class Phrase extends konnakol.Chunk {
  constructor(chunks) {
    super(chunks, 1);
  }

  getDuration() {
    return super.getDuration(1);
  }

  play(when=0, soundLibrary) {
    super.play(when, 1, soundLibrary);
  }
};

konnakol.Syllable = class Syllable {
  constructor(syllable, type, gati=4) {
    this.type = type;
    this.syllable = syllable;
    this.gati = gati;
  }

  setGati(gati) {
    this.gati = gati;
  }

  getDuration(speed) {
    return (1 / this.gati) / speed;
  }

  play(when=0, speedCount, soundLibrary=konnakol.soundLibraries.default) {
    const buffer = soundLibrary.get(this.syllable.toLowerCase(), this.type);
    audio.playSample(buffer, when);
  }

  toString() {
    return `${this.gati}${this.syllable}`;
  }
};

konnakol.Silence = class Silence extends konnakol.Syllable {
  constructor(symbol, type) {
    super(symbol, type);
  }

  play(when=0, speedCount, soundLibrary) {
    // do nothing!
    return;
  }
};

konnakol.repeatChunksExp = (chunksExp, repeatExp) => {
  const originalSubchunks = chunksExp.interpret();
  let numRepeats = repeatExp.interpret()[0];
  numRepeats = numRepeats === undefined ? 1 : numRepeats;
  const numSubchunks = numRepeats * originalSubchunks.length;
  return Array.from(Array(numSubchunks)).map((x, i) => {
    return originalSubchunks[i % originalSubchunks.length];
  });
};

konnakol.semantics.addOperation('interpret', {
  Phrase (chunksExp) {
    const chunks = chunksExp.interpret();
    return new konnakol.Phrase(chunksExp.interpret());
  },
  Gati (prefixExp, gatiExp) {
    return parseInt(gatiExp.sourceString, 10);
  },
  Repeat (operatorExp, mulExp) {
    return parseInt(mulExp.sourceString, 10);
  },
  Chunk_normal (gatiExp, chunksExp, repeatExp) {
    const subchunks = konnakol.repeatChunksExp(chunksExp, repeatExp);
    const gati = gatiExp.interpret()[0];
    return new konnakol.Chunk(subchunks, 1, gati);
  },
  Chunk_paren (gatiExp, openExp, chunksExp, closeExp, repeatExp) {
    const subchunks = konnakol.repeatChunksExp(chunksExp, repeatExp);
    const gati = gatiExp.interpret()[0];
    return new konnakol.Chunk(subchunks, 1, gati);
  },
  ChunkDouble_recur (startExp, chunkExp, endExp) {
    return new konnakol.Chunk([chunkExp.interpret()], 2);
  },
  ChunkDouble_base (startExp, chunksExp, endExp) {
    return new konnakol.Chunk(chunksExp.interpret(), 2);
  },
  ChunkHalf_recur (startExp, chunkExp, endExp) {
    return new konnakol.Chunk([chunkExp.interpret()], 0.5);
  },
  ChunkHalf_base (startExp, chunksExp, endExp) {
    return new konnakol.Chunk(chunksExp.interpret(), 0.5);
  },
  word (syllablesExp) {
    return new konnakol.Word(syllablesExp.interpret(), 1);
  },
  syllable_normal (consonantExp, vowelExp) {
    const syllable = consonantExp.sourceString + vowelExp.sourceString;
    return new konnakol.Syllable(syllable, 'normal');
  },
  syllable_stressed (consonantExp, vowelExp) {
    const syllable = consonantExp.sourceString + vowelExp.sourceString;
    return new konnakol.Syllable(syllable, 'stress');
  },
  silence_extension (exp) {
    return new konnakol.Silence(exp.sourceString, 'extension');
  },
  silence_rest (exp) {
    return new konnakol.Silence(exp.sourceString, 'rest');
  }
});

konnakol.play = function(input, when=0.2, soundLibraryKey='default') {
  const result = konnakol.grammar.match(input);
  if (result.failed()) {
    throw Error(`Parsing failed, bad input!\n${result.message}`);
  }

  const node = konnakol.semantics(result);
  const phrase = node.interpret();
  const soundLibrary = konnakol.soundLibraries[soundLibraryKey];
  phrase.play(when, soundLibrary);
  return phrase;
};

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeLeet, buildBannedRegex } = require('../utils.js');

// Load the actual banned words list by mocking window
global.window = {};
require('../banned-words.js');
const BANNED_WORDS = global.window.__BETTER_YT_BANNED_WORDS;

const re = buildBannedRegex(BANNED_WORDS);
const check = msg => re.test(normalizeLeet(msg));

// ---------------------------------------------------------------------------
// Sanity check
// ---------------------------------------------------------------------------

describe('banned-words list', () => {
    it('loaded words from banned-words.js', () => {
        assert.ok(Array.isArray(BANNED_WORDS) && BANNED_WORDS.length > 0);
    });
    it('regex built successfully', () => {
        assert.ok(re instanceof RegExp);
    });
});

// ---------------------------------------------------------------------------
// Slurs
// ---------------------------------------------------------------------------

describe('"nigger"', () => {
    it('plain',               () => assert.ok(check('nigger')));
    it('uppercase',           () => assert.ok(check('NIGGER')));
    it('in a sentence',       () => assert.ok(check('you are a nigger lol')));
    it('leet: n1gger',        () => assert.ok(check('n1gger')));
    it('leet: n!gger',        () => assert.ok(check('n!gger')));
    it('leet: nigg3r',        () => assert.ok(check('nigg3r')));
    it('leet: n1gg3r',        () => assert.ok(check('n1gg3r')));
    it('leet: N1GG3R',        () => assert.ok(check('N1GG3R')));
});

describe('"nigg"', () => {
    it('plain',               () => assert.ok(check('nigg')));
    it('leet: n1gg',          () => assert.ok(check('n1gg')));
    it('no match in niggardly', () => assert.ok(!check('niggardly')));
});

describe('"faggot"', () => {
    it('plain',               () => assert.ok(check('faggot')));
    it('uppercase',           () => assert.ok(check('FAGGOT')));
    it('leet: f@ggot',        () => assert.ok(check('f@ggot')));
    it('leet: f4ggot',        () => assert.ok(check('f4ggot')));
    it('leet: f@gg07',        () => assert.ok(check('f@gg07')));
    it('leet: fagg0t',        () => assert.ok(check('fagg0t')));
});

describe('"fag"', () => {
    it('plain',               () => assert.ok(check('fag')));
    it('leet: f@g',           () => assert.ok(check('f@g')));
    it('in a sentence',       () => assert.ok(check('you are such a fag')));
});

// ---------------------------------------------------------------------------
// Political phrases
// ---------------------------------------------------------------------------

describe('"MAGA 2028"', () => {
    it('plain',               () => assert.ok(check('MAGA 2028')));
    it('lowercase',           () => assert.ok(check('maga 2028')));
    it('in a sentence',       () => assert.ok(check('vote maga 2028 everyone')));
    it('leet: m@g@ 2028',     () => assert.ok(check('m@g@ 2028')));
});

describe('"trump 2028"', () => {
    it('plain',               () => assert.ok(check('trump 2028')));
    it('uppercase',           () => assert.ok(check('TRUMP 2028')));
    it('in a sentence',       () => assert.ok(check('support trump 2028 now')));
    it('leet: 7rump 2028',    () => assert.ok(check('7rump 2028')));
});

describe('"trump is god"', () => {
    it('plain',               () => assert.ok(check('trump is god')));
    it('uppercase',           () => assert.ok(check('TRUMP IS GOD')));
    it('leet: 7rump is god',  () => assert.ok(check('7rump is god')));
});

describe('"trump is king"', () => {
    it('plain',               () => assert.ok(check('trump is king')));
    it('uppercase',           () => assert.ok(check('TRUMP IS KING')));
});

describe('"fire kimmel"', () => {
    it('plain',               () => assert.ok(check('fire kimmel')));
    it('uppercase',           () => assert.ok(check('FIRE KIMMEL')));
    it('leet: f1re kimmel',   () => assert.ok(check('f1re kimmel')));
    it('in a sentence',       () => assert.ok(check('they should fire kimmel immediately')));
});

describe('"fire jimmy kimmel"', () => {
    it('plain',               () => assert.ok(check('fire jimmy kimmel')));
    it('uppercase',           () => assert.ok(check('FIRE JIMMY KIMMEL')));
    it('leet: f1re j1mmy k1mm3l', () => assert.ok(check('f1re j1mmy k1mm3l')));
});

// ---------------------------------------------------------------------------
// Clean messages — should NOT be flagged
// ---------------------------------------------------------------------------

describe('clean messages', () => {
    it('positive comment',        () => assert.ok(!check('great stream today!')));
    it('question',                () => assert.ok(!check('what settings are you using?')));
    it('mild profanity',          () => assert.ok(!check('holy shit that clip was insane')));
    it('game trash talk',         () => assert.ok(!check('you are so bad at this game lol')));
    it('excited reaction',        () => assert.ok(!check('LETS GOOOOO')));
    it('timestamp with numbers',  () => assert.ok(!check('best moment at 1:30')));
    it('"niggardly" not flagged', () => assert.ok(!check('the niggardly budget cuts')));
});

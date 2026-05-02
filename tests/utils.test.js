const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeLeet, buildBannedRegex } = require('../utils.js');

// ---------------------------------------------------------------------------
// normalizeLeet
// ---------------------------------------------------------------------------

describe('normalizeLeet', () => {

    describe('individual substitutions', () => {
        it('replaces @ with a', () => assert.equal(normalizeLeet('f@ggot'), 'faggot'));
        it('replaces 4 with a', () => assert.equal(normalizeLeet('f4ggot'), 'faggot'));
        it('replaces 3 with e', () => assert.equal(normalizeLeet('nigg3r'), 'nigger'));
        it('replaces 1 with i', () => assert.equal(normalizeLeet('n1gger'), 'nigger'));
        it('replaces ! with i', () => assert.equal(normalizeLeet('n!gger'), 'nigger'));
        it('replaces | with i', () => assert.equal(normalizeLeet('n|gger'), 'nigger'));
        it('replaces 0 with o', () => assert.equal(normalizeLeet('m0ron'),  'moron'));
        it('replaces $ with s', () => assert.equal(normalizeLeet('$tupid'), 'stupid'));
        it('replaces 5 with s', () => assert.equal(normalizeLeet('5tupid'), 'stupid'));
        it('replaces 7 with t', () => assert.equal(normalizeLeet('7watt'),  'twatt'));
    });

    describe('combined substitutions', () => {
        it('handles multiple substitutions in one word', () =>
            assert.equal(normalizeLeet('n1gg3r'), 'nigger'));
        it('handles fully encoded word', () =>
            assert.equal(normalizeLeet('f@gg07'), 'faggot'));
    });

    describe('case handling', () => {
        it('lowercases plain text', () =>
            assert.equal(normalizeLeet('GREAT STREAM'), 'great stream'));
        it('lowercases before substituting', () =>
            assert.equal(normalizeLeet('N1GGER'), 'nigger'));
    });

    describe('edge cases', () => {
        it('returns empty string unchanged', () =>
            assert.equal(normalizeLeet(''), ''));
        it('leaves clean text unchanged (besides lowercase)', () =>
            assert.equal(normalizeLeet('great stream today'), 'great stream today'));
        it('does not mangle numbers that are not leet substitutions', () =>
            assert.equal(normalizeLeet('score is 22'), 'score is 22'));
    });
});

// ---------------------------------------------------------------------------
// buildBannedRegex
// ---------------------------------------------------------------------------

describe('buildBannedRegex', () => {

    describe('input handling', () => {
        it('returns null for empty array', () =>
            assert.equal(buildBannedRegex([]), null));
        it('returns null for undefined', () =>
            assert.equal(buildBannedRegex(undefined), null));
        it('returns null when all entries are blank', () =>
            assert.equal(buildBannedRegex(['', '   ']), null));
        it('trims whitespace from entries', () => {
            const re = buildBannedRegex(['  badword  ']);
            assert.ok(re.test('badword'));
        });
    });

    describe('matching', () => {
        it('matches a word in the list', () => {
            const re = buildBannedRegex(['badword']);
            assert.ok(re.test('this contains badword here'));
        });
        it('does not match a word not in the list', () => {
            const re = buildBannedRegex(['badword']);
            assert.ok(!re.test('this is fine'));
        });
        it('matches multi-word phrases', () => {
            const re = buildBannedRegex(['buy followers']);
            assert.ok(re.test('click here to buy followers now'));
        });
        it('is case-insensitive', () => {
            const re = buildBannedRegex(['badword']);
            assert.ok(re.test('BADWORD'));
            assert.ok(re.test('BadWord'));
        });
        it('matches any word in a multi-word list', () => {
            const re = buildBannedRegex(['alpha', 'beta', 'gamma']);
            assert.ok(re.test('beta is here'));
            assert.ok(re.test('gamma ray'));
            assert.ok(!re.test('delta'));
        });
    });

    describe('word boundaries', () => {
        it('does not match when the word is a substring of a longer word', () => {
            const re = buildBannedRegex(['ass']);
            assert.ok(!re.test('assistance'));
            assert.ok(!re.test('classic'));
        });
        it('matches the word when it stands alone', () => {
            const re = buildBannedRegex(['ass']);
            assert.ok(re.test('what an ass'));
        });
    });

    describe('special character escaping', () => {
        it('escapes regex special chars in banned phrases', () => {
            const re = buildBannedRegex(['f.ck']);
            // The dot should be literal, not a regex wildcard
            assert.ok(re.test('f.ck'));
            assert.ok(!re.test('fxck'));
        });
    });
});

// ---------------------------------------------------------------------------
// Full pipeline: normalizeLeet → buildBannedRegex
// ---------------------------------------------------------------------------

describe('leet detection pipeline', () => {
    const bannedWords = ['nigger', 'faggot', 'buy followers'];
    const re = buildBannedRegex(bannedWords);

    function check(message) {
        return re.test(normalizeLeet(message));
    }

    it('catches plain banned word',          () => assert.ok(check('nigger')));
    it('catches 1→i substitution',           () => assert.ok(check('n1gger')));
    it('catches !→i substitution',           () => assert.ok(check('n!gger')));
    it('catches 3→e substitution',           () => assert.ok(check('nigg3r')));
    it('catches combined substitutions',     () => assert.ok(check('n1gg3r')));
    it('catches @→a substitution',           () => assert.ok(check('f@ggot')));
    it('catches 4→a substitution',           () => assert.ok(check('f4ggot')));
    it('catches fully leet-encoded word',    () => assert.ok(check('f@gg07')));
    it('catches leet in a sentence',         () => assert.ok(check('you are a n1gg3r lol')));
    it('catches banned phrase',              () => assert.ok(check('click here to buy followers')));
    it('does not flag clean message',        () => assert.ok(!check('great stream today!')));
    it('does not flag mild profanity',       () => assert.ok(!check('holy shit that was insane')));
    it('does not flag number in timestamp',  () => assert.ok(!check('highlight at 1:30')));
});

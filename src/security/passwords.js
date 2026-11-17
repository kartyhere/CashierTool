'use strict';
// Password and PIN hashing with scrypt. A hash is stored as one text field:
//   scrypt$<N>$<r>$<p>$<salt base64>$<hash base64>
// so the cost can be raised later and old hashes still verify.
const crypto = require('node:crypto');
const { UserError } = require('../errors');

const N = 32768;
const R = 8;
const P = 1;
const KEYLEN = 32;
const MAXMEM = 64 * 1024 * 1024;

const normalize = (text) => String(text).normalize('NFKC');

function derive(password, salt, n, r, p, len) {
  return crypto.scryptSync(normalize(password), salt, len, { N: n, r, p, maxmem: MAXMEM });
}

function hash(password) {
  const salt = crypto.randomBytes(16);
  const dk = derive(password, salt, N, R, P, KEYLEN);
  return ['scrypt', N, R, P, salt.toString('base64'), dk.toString('base64')].join('$');
}

function verify(password, stored) {
  try {
    const [tag, n, r, p, saltB64, hashB64] = String(stored).split('$');
    if (tag !== 'scrypt') return false;
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    if (salt.length !== 16 || expected.length !== KEYLEN) return false;
    const actual = derive(password, salt, Number(n), Number(r), Number(p), expected.length);
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// Verifying against this when the user name does not exist keeps the response time the same either way.
let dummy;
function verifyDummy(password) {
  dummy = dummy || hash('not-a-real-password');
  verify(password, dummy);
  return false;
}

function validateUsername(value) {
  const name = String(value == null ? '' : value).trim();
  if (name.length < 3 || name.length > 40) throw new UserError('Username must be 3 to 40 characters.');
  if (/[\u0000-\u001f\u007f]/.test(name)) throw new UserError('Username contains characters that are not allowed.');
  return name;
}

// A PIN is allowed (4 characters or more). Longer is better; the limit only stops absurd input.
function validatePassword(value) {
  if (typeof value !== 'string' || value.length < 4 || value.length > 128) {
    throw new UserError('Password or PIN must be 4 to 128 characters.');
  }
  return value;
}

module.exports = { hash, verify, verifyDummy, validateUsername, validatePassword };

// Generates the 6 character hold codes.
//
// I left out 0, O, 1, I and L on purpose - if someone reads this code out
// loud over the phone, or types it on a phone keyboard, those characters
// get mixed up with each other all the time. That leaves 31 safe
// characters, so 31^6 (about 887 million) possible codes, which is loads
// for a single event.

const ALLOWED_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;

function generateCode() {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    // just grabbing a random character from the allowed set, one at a time
    const randomIndex = Math.floor(Math.random() * ALLOWED_CHARS.length);
    code += ALLOWED_CHARS[randomIndex];
  }
  return code;
}

module.exports = { generateCode, ALLOWED_CHARS, CODE_LENGTH };

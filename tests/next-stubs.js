'use strict';

// Lets route handlers run under node --test: next/headers' cookies() needs a live Next request, so
// install() swaps in the cookie jar below; 'next/server' only resolves without the extension in Next's bundler.

const { pathToFileURL } = require('node:url');

const jar = new Map();

const cookieStore = {
  get: (name) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
  set: (name, value) => {
    jar.set(name, value);
  },
  delete: (name) => {
    jar.delete(name);
  }
};

async function cookies() {
  return cookieStore;
}

let installed = false;

/** Call before lib/auth.js (or a route) is loaded. */
function install() {
  if (installed) return;
  installed = true;
  require('node:module').registerHooks({
    resolve(specifier, context, next) {
      if (specifier === 'next/headers') return { url: pathToFileURL(__filename).href, shortCircuit: true };
      return next(specifier === 'next/server' ? 'next/server.js' : specifier, context);
    }
  });
}

module.exports = { cookies, jar, install };

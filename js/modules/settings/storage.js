(function (global) {
  "use strict";
  if (global.XinyangStorage) return;
  function get(key) {
    try { return global.localStorage.getItem(key); } catch (error) { return null; }
  }
  function set(key, value) {
    try { global.localStorage.setItem(key, String(value)); return true; }
    catch (error) { return false; }
  }
  function remove(key) {
    try { global.localStorage.removeItem(key); } catch (error) {}
  }
  global.XinyangStorage = { get: get, set: set, remove: remove };
}(window));

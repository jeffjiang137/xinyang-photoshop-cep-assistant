/**
 * @license almond 0.2.9 Copyright (c) 2011-2014, The Dojo Foundation All Rights Reserved.
 * Available via the MIT or new BSD license.
 * see: http://github.com/jrburke/almond for details
 */
//Going sloppy to avoid 'use strict' string cost, but strict practices should
//be followed.
/*jslint sloppy: true */
/*global setTimeout: false */

var requirejs, require, define;
(function (undef) {
    var main, req, makeMap, handlers,
        defined = {},
        waiting = {},
        config = {},
        defining = {},
        hasOwn = Object.prototype.hasOwnProperty,
        aps = [].slice,
        jsSuffixRegExp = /\.js$/;

    function hasProp(obj, prop) {
        return hasOwn.call(obj, prop);
    }

    /**
     * Given a relative module name, like ./something, normalize it to
     * a real name that can be mapped to a path.
     * @param {String} name the relative name
     * @param {String} baseName a real name that the name arg is relative
     * to.
     * @returns {String} normalized name
     */
    function normalize(name, baseName) {
        var nameParts, nameSegment, mapValue, foundMap, lastIndex,
            foundI, foundStarMap, starI, i, j, part,
            baseParts = baseName && baseName.split("/"),
            map = config.map,
            starMap = (map && map['*']) || {};

        //Adjust any relative paths.
        if (name && name.charAt(0) === ".") {
            //If have a base name, try to normalize against it,
            //otherwise, assume it is a top-level require that will
            //be relative to baseUrl in the end.
            if (baseName) {
                //Convert baseName to array, and lop off the last part,
                //so that . matches that "directory" and not name of the baseName's
                //module. For instance, baseName of "one/two/three", maps to
                //"one/two/three.js", but we want the directory, "one/two" for
                //this normalization.
                baseParts = baseParts.slice(0, baseParts.length - 1);
                name = name.split('/');
                lastIndex = name.length - 1;

                // Node .js allowance:
                if (config.nodeIdCompat && jsSuffixRegExp.test(name[lastIndex])) {
                    name[lastIndex] = name[lastIndex].replace(jsSuffixRegExp, '');
                }

                name = baseParts.concat(name);

                //start trimDots
                for (i = 0; i < name.length; i += 1) {
                    part = name[i];
                    if (part === ".") {
                        name.splice(i, 1);
                        i -= 1;
                    } else if (part === "..") {
                        if (i === 1 && (name[2] === '..' || name[0] === '..')) {
                            //End of the line. Keep at least one non-dot
                            //path segment at the front so it can be mapped
                            //correctly to disk. Otherwise, there is likely
                            //no path mapping for a path starting with '..'.
                            //This can still fail, but catches the most reasonable
                            //uses of ..
                            break;
                        } else if (i > 0) {
                            name.splice(i - 1, 2);
                            i -= 2;
                        }
                    }
                }
                //end trimDots

                name = name.join("/");
            } else if (name.indexOf('./') === 0) {
                // No baseName, so this is ID is resolved relative
                // to baseUrl, pull off the leading dot.
                name = name.substring(2);
            }
        }

        //Apply map config if available.
        if ((baseParts || starMap) && map) {
            nameParts = name.split('/');

            for (i = nameParts.length; i > 0; i -= 1) {
                nameSegment = nameParts.slice(0, i).join("/");

                if (baseParts) {
                    //Find the longest baseName segment match in the config.
                    //So, do joins on the biggest to smallest lengths of baseParts.
                    for (j = baseParts.length; j > 0; j -= 1) {
                        mapValue = map[baseParts.slice(0, j).join('/')];

                        //baseName segment has  config, find if it has one for
                        //this name.
                        if (mapValue) {
                            mapValue = mapValue[nameSegment];
                            if (mapValue) {
                                //Match, update name to the new value.
                                foundMap = mapValue;
                                foundI = i;
                                break;
                            }
                        }
                    }
                }

                if (foundMap) {
                    break;
                }

                //Check for a star map match, but just hold on to it,
                //if there is a shorter segment match later in a matching
                //config, then favor over this star map.
                if (!foundStarMap && starMap && starMap[nameSegment]) {
                    foundStarMap = starMap[nameSegment];
                    starI = i;
                }
            }

            if (!foundMap && foundStarMap) {
                foundMap = foundStarMap;
                foundI = starI;
            }

            if (foundMap) {
                nameParts.splice(0, foundI, foundMap);
                name = nameParts.join('/');
            }
        }

        return name;
    }

    function makeRequire(relName, forceSync) {
        return function () {
            //A version of a require function that passes a moduleName
            //value for items that may need to
            //look up paths relative to the moduleName
            return req.apply(undef, aps.call(arguments, 0).concat([relName, forceSync]));
        };
    }

    function makeNormalize(relName) {
        return function (name) {
            return normalize(name, relName);
        };
    }

    function makeLoad(depName) {
        return function (value) {
            defined[depName] = value;
        };
    }

    function callDep(name) {
        if (hasProp(waiting, name)) {
            var args = waiting[name];
            delete waiting[name];
            defining[name] = true;
            main.apply(undef, args);
        }

        if (!hasProp(defined, name) && !hasProp(defining, name)) {
            throw new Error('No ' + name);
        }
        return defined[name];
    }

    //Turns a plugin!resource to [plugin, resource]
    //with the plugin being undefined if the name
    //did not have a plugin prefix.
    function splitPrefix(name) {
        var prefix,
            index = name ? name.indexOf('!') : -1;
        if (index > -1) {
            prefix = name.substring(0, index);
            name = name.substring(index + 1, name.length);
        }
        return [prefix, name];
    }

    /**
     * Makes a name map, normalizing the name, and using a plugin
     * for normalization if necessary. Grabs a ref to plugin
     * too, as an optimization.
     */
    makeMap = function (name, relName) {
        var plugin,
            parts = splitPrefix(name),
            prefix = parts[0];

        name = parts[1];

        if (prefix) {
            prefix = normalize(prefix, relName);
            plugin = callDep(prefix);
        }

        //Normalize according
        if (prefix) {
            if (plugin && plugin.normalize) {
                name = plugin.normalize(name, makeNormalize(relName));
            } else {
                name = normalize(name, relName);
            }
        } else {
            name = normalize(name, relName);
            parts = splitPrefix(name);
            prefix = parts[0];
            name = parts[1];
            if (prefix) {
                plugin = callDep(prefix);
            }
        }

        //Using ridiculous property names for space reasons
        return {
            f: prefix ? prefix + '!' + name : name, //fullName
            n: name,
            pr: prefix,
            p: plugin
        };
    };

    function makeConfig(name) {
        return function () {
            return (config && config.config && config.config[name]) || {};
        };
    }

    handlers = {
        require: function (name) {
            return makeRequire(name);
        },
        exports: function (name) {
            var e = defined[name];
            if (typeof e !== 'undefined') {
                return e;
            } else {
                return (defined[name] = {});
            }
        },
        module: function (name) {
            return {
                id: name,
                uri: '',
                exports: defined[name],
                config: makeConfig(name)
            };
        }
    };

    main = function (name, deps, callback, relName) {
        var cjsModule, depName, ret, map, i,
            args = [],
            callbackType = typeof callback,
            usingExports;

        //Use name if no relName
        relName = relName || name;

        //Call the callback to define the module, if necessary.
        if (callbackType === 'undefined' || callbackType === 'function') {
            //Pull out the defined dependencies and pass the ordered
            //values to the callback.
            //Default to [require, exports, module] if no deps
            deps = !deps.length && callback.length ? ['require', 'exports', 'module'] : deps;
            for (i = 0; i < deps.length; i += 1) {
                map = makeMap(deps[i], relName);
                depName = map.f;

                //Fast path CommonJS standard dependencies.
                if (depName === "require") {
                    args[i] = handlers.require(name);
                } else if (depName === "exports") {
                    //CommonJS module spec 1.1
                    args[i] = handlers.exports(name);
                    usingExports = true;
                } else if (depName === "module") {
                    //CommonJS module spec 1.1
                    cjsModule = args[i] = handlers.module(name);
                } else if (hasProp(defined, depName) ||
                           hasProp(waiting, depName) ||
                           hasProp(defining, depName)) {
                    args[i] = callDep(depName);
                } else if (map.p) {
                    map.p.load(map.n, makeRequire(relName, true), makeLoad(depName), {});
                    args[i] = defined[depName];
                } else {
                    throw new Error(name + ' missing ' + depName);
                }
            }

            ret = callback ? callback.apply(defined[name], args) : undefined;

            if (name) {
                //If setting exports via "module" is in play,
                //favor that over return value and exports. After that,
                //favor a non-undefined return value over exports use.
                if (cjsModule && cjsModule.exports !== undef &&
                        cjsModule.exports !== defined[name]) {
                    defined[name] = cjsModule.exports;
                } else if (ret !== undef || !usingExports) {
                    //Use the return value from the function.
                    defined[name] = ret;
                }
            }
        } else if (name) {
            //May just be an object definition for the module. Only
            //worry about defining if have a module name.
            defined[name] = callback;
        }
    };

    requirejs = require = req = function (deps, callback, relName, forceSync, alt) {
        if (typeof deps === "string") {
            if (handlers[deps]) {
                //callback in this case is really relName
                return handlers[deps](callback);
            }
            //Just return the module wanted. In this scenario, the
            //deps arg is the module name, and second arg (if passed)
            //is just the relName.
            //Normalize module name, if it contains . or ..
            return callDep(makeMap(deps, callback).f);
        } else if (!deps.splice) {
            //deps is a config object, not an array.
            config = deps;
            if (config.deps) {
                req(config.deps, config.callback);
            }
            if (!callback) {
                return;
            }

            if (callback.splice) {
                //callback is an array, which means it is a dependency list.
                //Adjust args if there are dependencies
                deps = callback;
                callback = relName;
                relName = null;
            } else {
                deps = undef;
            }
        }

        //Support require(['a'])
        callback = callback || function () {};

        //If relName is a function, it is an errback handler,
        //so remove it.
        if (typeof relName === 'function') {
            relName = forceSync;
            forceSync = alt;
        }

        //Simulate async callback;
        if (forceSync) {
            main(undef, deps, callback, relName);
        } else {
            //Using a non-zero value because of concern for what old browsers
            //do, and latest browsers "upgrade" to 4 if lower value is used:
            //http://www.whatwg.org/specs/web-apps/current-work/multipage/timers.html#dom-windowtimers-settimeout:
            //If want a value immediately, use require('id') instead -- something
            //that works in almond on the global level, but not guaranteed and
            //unlikely to work in other AMD implementations.
            setTimeout(function () {
                main(undef, deps, callback, relName);
            }, 4);
        }

        return req;
    };

    /**
     * Just drops the config on the floor, but returns req in case
     * the config return value is used.
     */
    req.config = function (cfg) {
        return req(cfg);
    };

    /**
     * Expose module registry for debugging and tooling
     */
    requirejs._defined = defined;

    define = function (name, deps, callback) {

        //This module may not have dependencies
        if (!deps.splice) {
            //deps is not an array, so probably means
            //an object literal or factory function for
            //the value. Adjust args.
            callback = deps;
            deps = [];
        }

        if (!hasProp(defined, name) && !hasProp(waiting, name)) {
            waiting[name] = [name, deps, callback];
        }
    };

    define.amd = {
        jQuery: true
    };
}());

define("../../bower_components/almond/almond", function(){});

/*!
 * jQuery JavaScript Library v1.9.0
 * http://jquery.com/
 *
 * Includes Sizzle.js
 * http://sizzlejs.com/
 *
 * Copyright 2005, 2012 jQuery Foundation, Inc. and other contributors
 * Released under the MIT license
 * http://jquery.org/license
 *
 * Date: 2013-1-14
 */
(function( window, undefined ) {
"use strict";
var
	// A central reference to the root jQuery(document)
	rootjQuery,

	// The deferred used on DOM ready
	readyList,

	// Use the correct document accordingly with window argument (sandbox)
	document = window.document,
	location = window.location,

	// Map over jQuery in case of overwrite
	_jQuery = window.jQuery,

	// Map over the $ in case of overwrite
	_$ = window.$,

	// [[Class]] -> type pairs
	class2type = {},

	// List of deleted data cache ids, so we can reuse them
	core_deletedIds = [],

	core_version = "1.9.0",

	// Save a reference to some core methods
	core_concat = core_deletedIds.concat,
	core_push = core_deletedIds.push,
	core_slice = core_deletedIds.slice,
	core_indexOf = core_deletedIds.indexOf,
	core_toString = class2type.toString,
	core_hasOwn = class2type.hasOwnProperty,
	core_trim = core_version.trim,

	// Define a local copy of jQuery
	jQuery = function( selector, context ) {
		// The jQuery object is actually just the init constructor 'enhanced'
		return new jQuery.fn.init( selector, context, rootjQuery );
	},

	// Used for matching numbers
	core_pnum = /[+-]?(?:\d*\.|)\d+(?:[eE][+-]?\d+|)/.source,

	// Used for splitting on whitespace
	core_rnotwhite = /\S+/g,

	// Make sure we trim BOM and NBSP (here's looking at you, Safari 5.0 and IE)
	rtrim = /^[\s\uFEFF\xA0]+|[\s\uFEFF\xA0]+$/g,

	// A simple way to check for HTML strings
	// Prioritize #id over <tag> to avoid XSS via location.hash (#9521)
	// Strict HTML recognition (#11290: must start with <)
	rquickExpr = /^(?:(<[\w\W]+>)[^>]*|#([\w-]*))$/,

	// Match a standalone tag
	rsingleTag = /^<(\w+)\s*\/?>(?:<\/\1>|)$/,

	// JSON RegExp
	rvalidchars = /^[\],:{}\s]*$/,
	rvalidbraces = /(?:^|:|,)(?:\s*\[)+/g,
	rvalidescape = /\\(?:["\\\/bfnrt]|u[\da-fA-F]{4})/g,
	rvalidtokens = /"[^"\\\r\n]*"|true|false|null|-?(?:\d+\.|)\d+(?:[eE][+-]?\d+|)/g,

	// Matches dashed string for camelizing
	rmsPrefix = /^-ms-/,
	rdashAlpha = /-([\da-z])/gi,

	// Used by jQuery.camelCase as callback to replace()
	fcamelCase = function( all, letter ) {
		return letter.toUpperCase();
	},

	// The ready event handler and self cleanup method
	DOMContentLoaded = function() {
		if ( document.addEventListener ) {
			document.removeEventListener( "DOMContentLoaded", DOMContentLoaded, false );
			jQuery.ready();
		} else if ( document.readyState === "complete" ) {
			// we're here because readyState === "complete" in oldIE
			// which is good enough for us to call the dom ready!
			document.detachEvent( "onreadystatechange", DOMContentLoaded );
			jQuery.ready();
		}
	};

jQuery.fn = jQuery.prototype = {
	// The current version of jQuery being used
	jquery: core_version,

	constructor: jQuery,
	init: function( selector, context, rootjQuery ) {
		var match, elem;

		// HANDLE: $(""), $(null), $(undefined), $(false)
		if ( !selector ) {
			return this;
		}

		// Handle HTML strings
		if ( typeof selector === "string" ) {
			if ( selector.charAt(0) === "<" && selector.charAt( selector.length - 1 ) === ">" && selector.length >= 3 ) {
				// Assume that strings that start and end with <> are HTML and skip the regex check
				match = [ null, selector, null ];

			} else {
				match = rquickExpr.exec( selector );
			}

			// Match html or make sure no context is specified for #id
			if ( match && (match[1] || !context) ) {

				// HANDLE: $(html) -> $(array)
				if ( match[1] ) {
					context = context instanceof jQuery ? context[0] : context;

					// scripts is true for back-compat
					jQuery.merge( this, jQuery.parseHTML(
						match[1],
						context && context.nodeType ? context.ownerDocument || context : document,
						true
					) );

					// HANDLE: $(html, props)
					if ( rsingleTag.test( match[1] ) && jQuery.isPlainObject( context ) ) {
						for ( match in context ) {
							// Properties of context are called as methods if possible
							if ( jQuery.isFunction( this[ match ] ) ) {
								this[ match ]( context[ match ] );

							// ...and otherwise set as attributes
							} else {
								this.attr( match, context[ match ] );
							}
						}
					}

					return this;

				// HANDLE: $(#id)
				} else {
					elem = document.getElementById( match[2] );

					// Check parentNode to catch when Blackberry 4.6 returns
					// nodes that are no longer in the document #6963
					if ( elem && elem.parentNode ) {
						// Handle the case where IE and Opera return items
						// by name instead of ID
						if ( elem.id !== match[2] ) {
							return rootjQuery.find( selector );
						}

						// Otherwise, we inject the element directly into the jQuery object
						this.length = 1;
						this[0] = elem;
					}

					this.context = document;
					this.selector = selector;
					return this;
				}

			// HANDLE: $(expr, $(...))
			} else if ( !context || context.jquery ) {
				return ( context || rootjQuery ).find( selector );

			// HANDLE: $(expr, context)
			// (which is just equivalent to: $(context).find(expr)
			} else {
				return this.constructor( context ).find( selector );
			}

		// HANDLE: $(DOMElement)
		} else if ( selector.nodeType ) {
			this.context = this[0] = selector;
			this.length = 1;
			return this;

		// HANDLE: $(function)
		// Shortcut for document ready
		} else if ( jQuery.isFunction( selector ) ) {
			return rootjQuery.ready( selector );
		}

		if ( selector.selector !== undefined ) {
			this.selector = selector.selector;
			this.context = selector.context;
		}

		return jQuery.makeArray( selector, this );
	},

	// Start with an empty selector
	selector: "",

	// The default length of a jQuery object is 0
	length: 0,

	// The number of elements contained in the matched element set
	size: function() {
		return this.length;
	},

	toArray: function() {
		return core_slice.call( this );
	},

	// Get the Nth element in the matched element set OR
	// Get the whole matched element set as a clean array
	get: function( num ) {
		return num == null ?

			// Return a 'clean' array
			this.toArray() :

			// Return just the object
			( num < 0 ? this[ this.length + num ] : this[ num ] );
	},

	// Take an array of elements and push it onto the stack
	// (returning the new matched element set)
	pushStack: function( elems ) {

		// Build a new jQuery matched element set
		var ret = jQuery.merge( this.constructor(), elems );

		// Add the old object onto the stack (as a reference)
		ret.prevObject = this;
		ret.context = this.context;

		// Return the newly-formed element set
		return ret;
	},

	// Execute a callback for every element in the matched set.
	// (You can seed the arguments with an array of args, but this is
	// only used internally.)
	each: function( callback, args ) {
		return jQuery.each( this, callback, args );
	},

	ready: function( fn ) {
		// Add the callback
		jQuery.ready.promise().done( fn );

		return this;
	},

	slice: function() {
		return this.pushStack( core_slice.apply( this, arguments ) );
	},

	first: function() {
		return this.eq( 0 );
	},

	last: function() {
		return this.eq( -1 );
	},

	eq: function( i ) {
		var len = this.length,
			j = +i + ( i < 0 ? len : 0 );
		return this.pushStack( j >= 0 && j < len ? [ this[j] ] : [] );
	},

	map: function( callback ) {
		return this.pushStack( jQuery.map(this, function( elem, i ) {
			return callback.call( elem, i, elem );
		}));
	},

	end: function() {
		return this.prevObject || this.constructor(null);
	},

	// For internal use only.
	// Behaves like an Array's method, not like a jQuery method.
	push: core_push,
	sort: [].sort,
	splice: [].splice
};

// Give the init function the jQuery prototype for later instantiation
jQuery.fn.init.prototype = jQuery.fn;

jQuery.extend = jQuery.fn.extend = function() {
	var options, name, src, copy, copyIsArray, clone,
		target = arguments[0] || {},
		i = 1,
		length = arguments.length,
		deep = false;

	// Handle a deep copy situation
	if ( typeof target === "boolean" ) {
		deep = target;
		target = arguments[1] || {};
		// skip the boolean and the target
		i = 2;
	}

	// Handle case when target is a string or something (possible in deep copy)
	if ( typeof target !== "object" && !jQuery.isFunction(target) ) {
		target = {};
	}

	// extend jQuery itself if only one argument is passed
	if ( length === i ) {
		target = this;
		--i;
	}

	for ( ; i < length; i++ ) {
		// Only deal with non-null/undefined values
		if ( (options = arguments[ i ]) != null ) {
			// Extend the base object
			for ( name in options ) {
				src = target[ name ];
				copy = options[ name ];

				// Prevent never-ending loop
				if ( target === copy ) {
					continue;
				}

				// Recurse if we're merging plain objects or arrays
				if ( deep && copy && ( jQuery.isPlainObject(copy) || (copyIsArray = jQuery.isArray(copy)) ) ) {
					if ( copyIsArray ) {
						copyIsArray = false;
						clone = src && jQuery.isArray(src) ? src : [];

					} else {
						clone = src && jQuery.isPlainObject(src) ? src : {};
					}

					// Never move original objects, clone them
					target[ name ] = jQuery.extend( deep, clone, copy );

				// Don't bring in undefined values
				} else if ( copy !== undefined ) {
					target[ name ] = copy;
				}
			}
		}
	}

	// Return the modified object
	return target;
};

jQuery.extend({
	noConflict: function( deep ) {
		if ( window.$ === jQuery ) {
			window.$ = _$;
		}

		if ( deep && window.jQuery === jQuery ) {
			window.jQuery = _jQuery;
		}

		return jQuery;
	},

	// Is the DOM ready to be used? Set to true once it occurs.
	isReady: false,

	// A counter to track how many items to wait for before
	// the ready event fires. See #6781
	readyWait: 1,

	// Hold (or release) the ready event
	holdReady: function( hold ) {
		if ( hold ) {
			jQuery.readyWait++;
		} else {
			jQuery.ready( true );
		}
	},

	// Handle when the DOM is ready
	ready: function( wait ) {

		// Abort if there are pending holds or we're already ready
		if ( wait === true ? --jQuery.readyWait : jQuery.isReady ) {
			return;
		}

		// Make sure body exists, at least, in case IE gets a little overzealous (ticket #5443).
		if ( !document.body ) {
			return setTimeout( jQuery.ready );
		}

		// Remember that the DOM is ready
		jQuery.isReady = true;

		// If a normal DOM Ready event fired, decrement, and wait if need be
		if ( wait !== true && --jQuery.readyWait > 0 ) {
			return;
		}

		// If there are functions bound, to execute
		readyList.resolveWith( document, [ jQuery ] );

		// Trigger any bound ready events
		if ( jQuery.fn.trigger ) {
			jQuery( document ).trigger("ready").off("ready");
		}
	},

	// See test/unit/core.js for details concerning isFunction.
	// Since version 1.3, DOM methods and functions like alert
	// aren't supported. They return false on IE (#2968).
	isFunction: function( obj ) {
		return jQuery.type(obj) === "function";
	},

	isArray: Array.isArray || function( obj ) {
		return jQuery.type(obj) === "array";
	},

	isWindow: function( obj ) {
		return obj != null && obj == obj.window;
	},

	isNumeric: function( obj ) {
		return !isNaN( parseFloat(obj) ) && isFinite( obj );
	},

	type: function( obj ) {
		if ( obj == null ) {
			return String( obj );
		}
		return typeof obj === "object" || typeof obj === "function" ?
			class2type[ core_toString.call(obj) ] || "object" :
			typeof obj;
	},

	isPlainObject: function( obj ) {
		// Must be an Object.
		// Because of IE, we also have to check the presence of the constructor property.
		// Make sure that DOM nodes and window objects don't pass through, as well
		if ( !obj || jQuery.type(obj) !== "object" || obj.nodeType || jQuery.isWindow( obj ) ) {
			return false;
		}

		try {
			// Not own constructor property must be Object
			if ( obj.constructor &&
				!core_hasOwn.call(obj, "constructor") &&
				!core_hasOwn.call(obj.constructor.prototype, "isPrototypeOf") ) {
				return false;
			}
		} catch ( e ) {
			// IE8,9 Will throw exceptions on certain host objects #9897
			return false;
		}

		// Own properties are enumerated firstly, so to speed up,
		// if last one is own, then all properties are own.

		var key;
		for ( key in obj ) {}

		return key === undefined || core_hasOwn.call( obj, key );
	},

	isEmptyObject: function( obj ) {
		var name;
		for ( name in obj ) {
			return false;
		}
		return true;
	},

	error: function( msg ) {
		throw new Error( msg );
	},

	// data: string of html
	// context (optional): If specified, the fragment will be created in this context, defaults to document
	// keepScripts (optional): If true, will include scripts passed in the html string
	parseHTML: function( data, context, keepScripts ) {
		if ( !data || typeof data !== "string" ) {
			return null;
		}
		if ( typeof context === "boolean" ) {
			keepScripts = context;
			context = false;
		}
		context = context || document;

		var parsed = rsingleTag.exec( data ),
			scripts = !keepScripts && [];

		// Single tag
		if ( parsed ) {
			return [ context.createElement( parsed[1] ) ];
		}

		parsed = jQuery.buildFragment( [ data ], context, scripts );
		if ( scripts ) {
			jQuery( scripts ).remove();
		}
		return jQuery.merge( [], parsed.childNodes );
	},

	parseJSON: function( data ) {
		// Attempt to parse using the native JSON parser first
		if ( window.JSON && window.JSON.parse ) {
			return window.JSON.parse( data );
		}

		if ( data === null ) {
			return data;
		}

		if ( typeof data === "string" ) {

			// Make sure leading/trailing whitespace is removed (IE can't handle it)
			data = jQuery.trim( data );

			if ( data ) {
				// Make sure the incoming data is actual JSON
				// Logic borrowed from http://json.org/json2.js
				if ( rvalidchars.test( data.replace( rvalidescape, "@" )
					.replace( rvalidtokens, "]" )
					.replace( rvalidbraces, "")) ) {

					return ( new Function( "return " + data ) )();
				}
			}
		}

		jQuery.error( "Invalid JSON: " + data );
	},

	// Cross-browser xml parsing
	parseXML: function( data ) {
		var xml, tmp;
		if ( !data || typeof data !== "string" ) {
			return null;
		}
		try {
			if ( window.DOMParser ) { // Standard
				tmp = new DOMParser();
				xml = tmp.parseFromString( data , "text/xml" );
			} else { // IE
				xml = new ActiveXObject( "Microsoft.XMLDOM" );
				xml.async = "false";
				xml.loadXML( data );
			}
		} catch( e ) {
			xml = undefined;
		}
		if ( !xml || !xml.documentElement || xml.getElementsByTagName( "parsererror" ).length ) {
			jQuery.error( "Invalid XML: " + data );
		}
		return xml;
	},

	noop: function() {},

	// Evaluates a script in a global context
	// Workarounds based on findings by Jim Driscoll
	// http://weblogs.java.net/blog/driscoll/archive/2009/09/08/eval-javascript-global-context
	globalEval: function( data ) {
		if ( data && jQuery.trim( data ) ) {
			// We use execScript on Internet Explorer
			// We use an anonymous function so that context is window
			// rather than jQuery in Firefox
			( window.execScript || function( data ) {
				window[ "eval" ].call( window, data );
			} )( data );
		}
	},

	// Convert dashed to camelCase; used by the css and data modules
	// Microsoft forgot to hump their vendor prefix (#9572)
	camelCase: function( string ) {
		return string.replace( rmsPrefix, "ms-" ).replace( rdashAlpha, fcamelCase );
	},

	nodeName: function( elem, name ) {
		return elem.nodeName && elem.nodeName.toLowerCase() === name.toLowerCase();
	},

	// args is for internal usage only
	each: function( obj, callback, args ) {
		var value,
			i = 0,
			length = obj.length,
			isArray = isArraylike( obj );

		if ( args ) {
			if ( isArray ) {
				for ( ; i < length; i++ ) {
					value = callback.apply( obj[ i ], args );

					if ( value === false ) {
						break;
					}
				}
			} else {
				for ( i in obj ) {
					value = callback.apply( obj[ i ], args );

					if ( value === false ) {
						break;
					}
				}
			}

		// A special, fast, case for the most common use of each
		} else {
			if ( isArray ) {
				for ( ; i < length; i++ ) {
					value = callback.call( obj[ i ], i, obj[ i ] );

					if ( value === false ) {
						break;
					}
				}
			} else {
				for ( i in obj ) {
					value = callback.call( obj[ i ], i, obj[ i ] );

					if ( value === false ) {
						break;
					}
				}
			}
		}

		return obj;
	},

	// Use native String.trim function wherever possible
	trim: core_trim && !core_trim.call("\uFEFF\xA0") ?
		function( text ) {
			return text == null ?
				"" :
				core_trim.call( text );
		} :

		// Otherwise use our own trimming functionality
		function( text ) {
			return text == null ?
				"" :
				( text + "" ).replace( rtrim, "" );
		},

	// results is for internal usage only
	makeArray: function( arr, results ) {
		var ret = results || [];

		if ( arr != null ) {
			if ( isArraylike( Object(arr) ) ) {
				jQuery.merge( ret,
					typeof arr === "string" ?
					[ arr ] : arr
				);
			} else {
				core_push.call( ret, arr );
			}
		}

		return ret;
	},

	inArray: function( elem, arr, i ) {
		var len;

		if ( arr ) {
			if ( core_indexOf ) {
				return core_indexOf.call( arr, elem, i );
			}

			len = arr.length;
			i = i ? i < 0 ? Math.max( 0, len + i ) : i : 0;

			for ( ; i < len; i++ ) {
				// Skip accessing in sparse arrays
				if ( i in arr && arr[ i ] === elem ) {
					return i;
				}
			}
		}

		return -1;
	},

	merge: function( first, second ) {
		var l = second.length,
			i = first.length,
			j = 0;

		if ( typeof l === "number" ) {
			for ( ; j < l; j++ ) {
				first[ i++ ] = second[ j ];
			}
		} else {
			while ( second[j] !== undefined ) {
				first[ i++ ] = second[ j++ ];
			}
		}

		first.length = i;

		return first;
	},

	grep: function( elems, callback, inv ) {
		var retVal,
			ret = [],
			i = 0,
			length = elems.length;
		inv = !!inv;

		// Go through the array, only saving the items
		// that pass the validator function
		for ( ; i < length; i++ ) {
			retVal = !!callback( elems[ i ], i );
			if ( inv !== retVal ) {
				ret.push( elems[ i ] );
			}
		}

		return ret;
	},

	// arg is for internal usage only
	map: function( elems, callback, arg ) {
		var value,
			i = 0,
			length = elems.length,
			isArray = isArraylike( elems ),
			ret = [];

		// Go through the array, translating each of the items to their
		if ( isArray ) {
			for ( ; i < length; i++ ) {
				value = callback( elems[ i ], i, arg );

				if ( value != null ) {
					ret[ ret.length ] = value;
				}
			}

		// Go through every key on the object,
		} else {
			for ( i in elems ) {
				value = callback( elems[ i ], i, arg );

				if ( value != null ) {
					ret[ ret.length ] = value;
				}
			}
		}

		// Flatten any nested arrays
		return core_concat.apply( [], ret );
	},

	// A global GUID counter for objects
	guid: 1,

	// Bind a function to a context, optionally partially applying any
	// arguments.
	proxy: function( fn, context ) {
		var tmp, args, proxy;

		if ( typeof context === "string" ) {
			tmp = fn[ context ];
			context = fn;
			fn = tmp;
		}

		// Quick check to determine if target is callable, in the spec
		// this throws a TypeError, but we will just return undefined.
		if ( !jQuery.isFunction( fn ) ) {
			return undefined;
		}

		// Simulated bind
		args = core_slice.call( arguments, 2 );
		proxy = function() {
			return fn.apply( context || this, args.concat( core_slice.call( arguments ) ) );
		};

		// Set the guid of unique handler to the same of original handler, so it can be removed
		proxy.guid = fn.guid = fn.guid || jQuery.guid++;

		return proxy;
	},

	// Multifunctional method to get and set values of a collection
	// The value/s can optionally be executed if it's a function
	access: function( elems, fn, key, value, chainable, emptyGet, raw ) {
		var i = 0,
			length = elems.length,
			bulk = key == null;

		// Sets many values
		if ( jQuery.type( key ) === "object" ) {
			chainable = true;
			for ( i in key ) {
				jQuery.access( elems, fn, i, key[i], true, emptyGet, raw );
			}

		// Sets one value
		} else if ( value !== undefined ) {
			chainable = true;

			if ( !jQuery.isFunction( value ) ) {
				raw = true;
			}

			if ( bulk ) {
				// Bulk operations run against the entire set
				if ( raw ) {
					fn.call( elems, value );
					fn = null;

				// ...except when executing function values
				} else {
					bulk = fn;
					fn = function( elem, key, value ) {
						return bulk.call( jQuery( elem ), value );
					};
				}
			}

			if ( fn ) {
				for ( ; i < length; i++ ) {
					fn( elems[i], key, raw ? value : value.call( elems[i], i, fn( elems[i], key ) ) );
				}
			}
		}

		return chainable ?
			elems :

			// Gets
			bulk ?
				fn.call( elems ) :
				length ? fn( elems[0], key ) : emptyGet;
	},

	now: function() {
		return ( new Date() ).getTime();
	}
});

jQuery.ready.promise = function( obj ) {
	if ( !readyList ) {

		readyList = jQuery.Deferred();

		// Catch cases where $(document).ready() is called after the browser event has already occurred.
		// we once tried to use readyState "interactive" here, but it caused issues like the one
		// discovered by ChrisS here: http://bugs.jquery.com/ticket/12282#comment:15
		if ( document.readyState === "complete" ) {
			// Handle it asynchronously to allow scripts the opportunity to delay ready
			setTimeout( jQuery.ready );

		// Standards-based browsers support DOMContentLoaded
		} else if ( document.addEventListener ) {
			// Use the handy event callback
			document.addEventListener( "DOMContentLoaded", DOMContentLoaded, false );

			// A fallback to window.onload, that will always work
			window.addEventListener( "load", jQuery.ready, false );

		// If IE event model is used
		} else {
			// Ensure firing before onload, maybe late but safe also for iframes
			document.attachEvent( "onreadystatechange", DOMContentLoaded );

			// A fallback to window.onload, that will always work
			window.attachEvent( "onload", jQuery.ready );

			// If IE and not a frame
			// continually check to see if the document is ready
			var top = false;

			try {
				top = window.frameElement == null && document.documentElement;
			} catch(e) {}

			if ( top && top.doScroll ) {
				(function doScrollCheck() {
					if ( !jQuery.isReady ) {

						try {
							// Use the trick by Diego Perini
							// http://javascript.nwbox.com/IEContentLoaded/
							top.doScroll("left");
						} catch(e) {
							return setTimeout( doScrollCheck, 50 );
						}

						// and execute any waiting functions
						jQuery.ready();
					}
				})();
			}
		}
	}
	return readyList.promise( obj );
};

// Populate the class2type map
jQuery.each("Boolean Number String Function Array Date RegExp Object Error".split(" "), function(i, name) {
	class2type[ "[object " + name + "]" ] = name.toLowerCase();
});

function isArraylike( obj ) {
	var length = obj.length,
		type = jQuery.type( obj );

	if ( jQuery.isWindow( obj ) ) {
		return false;
	}

	if ( obj.nodeType === 1 && length ) {
		return true;
	}

	return type === "array" || type !== "function" &&
		( length === 0 ||
		typeof length === "number" && length > 0 && ( length - 1 ) in obj );
}

// All jQuery objects should point back to these
rootjQuery = jQuery(document);
// String to Object options format cache
var optionsCache = {};

// Convert String-formatted options into Object-formatted ones and store in cache
function createOptions( options ) {
	var object = optionsCache[ options ] = {};
	jQuery.each( options.match( core_rnotwhite ) || [], function( _, flag ) {
		object[ flag ] = true;
	});
	return object;
}

/*
 * Create a callback list using the following parameters:
 *
 *	options: an optional list of space-separated options that will change how
 *			the callback list behaves or a more traditional option object
 *
 * By default a callback list will act like an event callback list and can be
 * "fired" multiple times.
 *
 * Possible options:
 *
 *	once:			will ensure the callback list can only be fired once (like a Deferred)
 *
 *	memory:			will keep track of previous values and will call any callback added
 *					after the list has been fired right away with the latest "memorized"
 *					values (like a Deferred)
 *
 *	unique:			will ensure a callback can only be added once (no duplicate in the list)
 *
 *	stopOnFalse:	interrupt callings when a callback returns false
 *
 */
jQuery.Callbacks = function( options ) {

	// Convert options from String-formatted to Object-formatted if needed
	// (we check in cache first)
	options = typeof options === "string" ?
		( optionsCache[ options ] || createOptions( options ) ) :
		jQuery.extend( {}, options );

	var // Last fire value (for non-forgettable lists)
		memory,
		// Flag to know if list was already fired
		fired,
		// Flag to know if list is currently firing
		firing,
		// First callback to fire (used internally by add and fireWith)
		firingStart,
		// End of the loop when firing
		firingLength,
		// Index of currently firing callback (modified by remove if needed)
		firingIndex,
		// Actual callback list
		list = [],
		// Stack of fire calls for repeatable lists
		stack = !options.once && [],
		// Fire callbacks
		fire = function( data ) {
			memory = options.memory && data;
			fired = true;
			firingIndex = firingStart || 0;
			firingStart = 0;
			firingLength = list.length;
			firing = true;
			for ( ; list && firingIndex < firingLength; firingIndex++ ) {
				if ( list[ firingIndex ].apply( data[ 0 ], data[ 1 ] ) === false && options.stopOnFalse ) {
					memory = false; // To prevent further calls using add
					break;
				}
			}
			firing = false;
			if ( list ) {
				if ( stack ) {
					if ( stack.length ) {
						fire( stack.shift() );
					}
				} else if ( memory ) {
					list = [];
				} else {
					self.disable();
				}
			}
		},
		// Actual Callbacks object
		self = {
			// Add a callback or a collection of callbacks to the list
			add: function() {
				if ( list ) {
					// First, we save the current length
					var start = list.length;
					(function add( args ) {
						jQuery.each( args, function( _, arg ) {
							var type = jQuery.type( arg );
							if ( type === "function" ) {
								if ( !options.unique || !self.has( arg ) ) {
									list.push( arg );
								}
							} else if ( arg && arg.length && type !== "string" ) {
								// Inspect recursively
								add( arg );
							}
						});
					})( arguments );
					// Do we need to add the callbacks to the
					// current firing batch?
					if ( firing ) {
						firingLength = list.length;
					// With memory, if we're not firing then
					// we should call right away
					} else if ( memory ) {
						firingStart = start;
						fire( memory );
					}
				}
				return this;
			},
			// Remove a callback from the list
			remove: function() {
				if ( list ) {
					jQuery.each( arguments, function( _, arg ) {
						var index;
						while( ( index = jQuery.inArray( arg, list, index ) ) > -1 ) {
							list.splice( index, 1 );
							// Handle firing indexes
							if ( firing ) {
								if ( index <= firingLength ) {
									firingLength--;
								}
								if ( index <= firingIndex ) {
									firingIndex--;
								}
							}
						}
					});
				}
				return this;
			},
			// Control if a given callback is in the list
			has: function( fn ) {
				return jQuery.inArray( fn, list ) > -1;
			},
			// Remove all callbacks from the list
			empty: function() {
				list = [];
				return this;
			},
			// Have the list do nothing anymore
			disable: function() {
				list = stack = memory = undefined;
				return this;
			},
			// Is it disabled?
			disabled: function() {
				return !list;
			},
			// Lock the list in its current state
			lock: function() {
				stack = undefined;
				if ( !memory ) {
					self.disable();
				}
				return this;
			},
			// Is it locked?
			locked: function() {
				return !stack;
			},
			// Call all callbacks with the given context and arguments
			fireWith: function( context, args ) {
				args = args || [];
				args = [ context, args.slice ? args.slice() : args ];
				if ( list && ( !fired || stack ) ) {
					if ( firing ) {
						stack.push( args );
					} else {
						fire( args );
					}
				}
				return this;
			},
			// Call all the callbacks with the given arguments
			fire: function() {
				self.fireWith( this, arguments );
				return this;
			},
			// To know if the callbacks have already been called at least once
			fired: function() {
				return !!fired;
			}
		};

	return self;
};
jQuery.extend({

	Deferred: function( func ) {
		var tuples = [
				// action, add listener, listener list, final state
				[ "resolve", "done", jQuery.Callbacks("once memory"), "resolved" ],
				[ "reject", "fail", jQuery.Callbacks("once memory"), "rejected" ],
				[ "notify", "progress", jQuery.Callbacks("memory") ]
			],
			state = "pending",
			promise = {
				state: function() {
					return state;
				},
				always: function() {
					deferred.done( arguments ).fail( arguments );
					return this;
				},
				then: function( /* fnDone, fnFail, fnProgress */ ) {
					var fns = arguments;
					return jQuery.Deferred(function( newDefer ) {
						jQuery.each( tuples, function( i, tuple ) {
							var action = tuple[ 0 ],
								fn = jQuery.isFunction( fns[ i ] ) && fns[ i ];
							// deferred[ done | fail | progress ] for forwarding actions to newDefer
							deferred[ tuple[1] ](function() {
								var returned = fn && fn.apply( this, arguments );
								if ( returned && jQuery.isFunction( returned.promise ) ) {
									returned.promise()
										.done( newDefer.resolve )
										.fail( newDefer.reject )
										.progress( newDefer.notify );
								} else {
									newDefer[ action + "With" ]( this === promise ? newDefer.promise() : this, fn ? [ returned ] : arguments );
								}
							});
						});
						fns = null;
					}).promise();
				},
				// Get a promise for this deferred
				// If obj is provided, the promise aspect is added to the object
				promise: function( obj ) {
					return obj != null ? jQuery.extend( obj, promise ) : promise;
				}
			},
			deferred = {};

		// Keep pipe for back-compat
		promise.pipe = promise.then;

		// Add list-specific methods
		jQuery.each( tuples, function( i, tuple ) {
			var list = tuple[ 2 ],
				stateString = tuple[ 3 ];

			// promise[ done | fail | progress ] = list.add
			promise[ tuple[1] ] = list.add;

			// Handle state
			if ( stateString ) {
				list.add(function() {
					// state = [ resolved | rejected ]
					state = stateString;

				// [ reject_list | resolve_list ].disable; progress_list.lock
				}, tuples[ i ^ 1 ][ 2 ].disable, tuples[ 2 ][ 2 ].lock );
			}

			// deferred[ resolve | reject | notify ]
			deferred[ tuple[0] ] = function() {
				deferred[ tuple[0] + "With" ]( this === deferred ? promise : this, arguments );
				return this;
			};
			deferred[ tuple[0] + "With" ] = list.fireWith;
		});

		// Make the deferred a promise
		promise.promise( deferred );

		// Call given func if any
		if ( func ) {
			func.call( deferred, deferred );
		}

		// All done!
		return deferred;
	},

	// Deferred helper
	when: function( subordinate /* , ..., subordinateN */ ) {
		var i = 0,
			resolveValues = core_slice.call( arguments ),
			length = resolveValues.length,

			// the count of uncompleted subordinates
			remaining = length !== 1 || ( subordinate && jQuery.isFunction( subordinate.promise ) ) ? length : 0,

			// the master Deferred. If resolveValues consist of only a single Deferred, just use that.
			deferred = remaining === 1 ? subordinate : jQuery.Deferred(),

			// Update function for both resolve and progress values
			updateFunc = function( i, contexts, values ) {
				return function( value ) {
					contexts[ i ] = this;
					values[ i ] = arguments.length > 1 ? core_slice.call( arguments ) : value;
					if( values === progressValues ) {
						deferred.notifyWith( contexts, values );
					} else if ( !( --remaining ) ) {
						deferred.resolveWith( contexts, values );
					}
				};
			},

			progressValues, progressContexts, resolveContexts;

		// add listeners to Deferred subordinates; treat others as resolved
		if ( length > 1 ) {
			progressValues = new Array( length );
			progressContexts = new Array( length );
			resolveContexts = new Array( length );
			for ( ; i < length; i++ ) {
				if ( resolveValues[ i ] && jQuery.isFunction( resolveValues[ i ].promise ) ) {
					resolveValues[ i ].promise()
						.done( updateFunc( i, resolveContexts, resolveValues ) )
						.fail( deferred.reject )
						.progress( updateFunc( i, progressContexts, progressValues ) );
				} else {
					--remaining;
				}
			}
		}

		// if we're not waiting on anything, resolve the master
		if ( !remaining ) {
			deferred.resolveWith( resolveContexts, resolveValues );
		}

		return deferred.promise();
	}
});
jQuery.support = (function() {

	var support, all, a, select, opt, input, fragment, eventName, isSupported, i,
		div = document.createElement("div");

	// Setup
	div.setAttribute( "className", "t" );
	div.innerHTML = "  <link/><table></table><a href='/a'>a</a><input type='checkbox'/>";

	// Support tests won't run in some limited or non-browser environments
	all = div.getElementsByTagName("*");
	a = div.getElementsByTagName("a")[ 0 ];
	if ( !all || !a || !all.length ) {
		return {};
	}

	// First batch of tests
	select = document.createElement("select");
	opt = select.appendChild( document.createElement("option") );
	input = div.getElementsByTagName("input")[ 0 ];

	a.style.cssText = "top:1px;float:left;opacity:.5";
	support = {
		// Test setAttribute on camelCase class. If it works, we need attrFixes when doing get/setAttribute (ie6/7)
		getSetAttribute: div.className !== "t",

		// IE strips leading whitespace when .innerHTML is used
		leadingWhitespace: div.firstChild.nodeType === 3,

		// Make sure that tbody elements aren't automatically inserted
		// IE will insert them into empty tables
		tbody: !div.getElementsByTagName("tbody").length,

		// Make sure that link elements get serialized correctly by innerHTML
		// This requires a wrapper element in IE
		htmlSerialize: !!div.getElementsByTagName("link").length,

		// Get the style information from getAttribute
		// (IE uses .cssText instead)
		style: /top/.test( a.getAttribute("style") ),

		// Make sure that URLs aren't manipulated
		// (IE normalizes it by default)
		hrefNormalized: a.getAttribute("href") === "/a",

		// Make sure that element opacity exists
		// (IE uses filter instead)
		// Use a regex to work around a WebKit issue. See #5145
		opacity: /^0.5/.test( a.style.opacity ),

		// Verify style float existence
		// (IE uses styleFloat instead of cssFloat)
		cssFloat: !!a.style.cssFloat,

		// Check the default checkbox/radio value ("" on WebKit; "on" elsewhere)
		checkOn: !!input.value,

		// Make sure that a selected-by-default option has a working selected property.
		// (WebKit defaults to false instead of true, IE too, if it's in an optgroup)
		optSelected: opt.selected,

		// Tests for enctype support on a form (#6743)
		enctype: !!document.createElement("form").enctype,

		// Makes sure cloning an html5 element does not cause problems
		// Where outerHTML is undefined, this still works
		html5Clone: document.createElement("nav").cloneNode( true ).outerHTML !== "<:nav></:nav>",

		// jQuery.support.boxModel DEPRECATED in 1.8 since we don't support Quirks Mode
		boxModel: document.compatMode === "CSS1Compat",

		// Will be defined later
		deleteExpando: true,
		noCloneEvent: true,
		inlineBlockNeedsLayout: false,
		shrinkWrapBlocks: false,
		reliableMarginRight: true,
		boxSizingReliable: true,
		pixelPosition: false
	};

	// Make sure checked status is properly cloned
	input.checked = true;
	support.noCloneChecked = input.cloneNode( true ).checked;

	// Make sure that the options inside disabled selects aren't marked as disabled
	// (WebKit marks them as disabled)
	select.disabled = true;
	support.optDisabled = !opt.disabled;

	// Support: IE<9
	try {
		delete div.test;
	} catch( e ) {
		support.deleteExpando = false;
	}

	// Check if we can trust getAttribute("value")
	input = document.createElement("input");
	input.setAttribute( "value", "" );
	support.input = input.getAttribute( "value" ) === "";

	// Check if an input maintains its value after becoming a radio
	input.value = "t";
	input.setAttribute( "type", "radio" );
	support.radioValue = input.value === "t";

	// #11217 - WebKit loses check when the name is after the checked attribute
	input.setAttribute( "checked", "t" );
	input.setAttribute( "name", "t" );

	fragment = document.createDocumentFragment();
	fragment.appendChild( input );

	// Check if a disconnected checkbox will retain its checked
	// value of true after appended to the DOM (IE6/7)
	support.appendChecked = input.checked;

	// WebKit doesn't clone checked state correctly in fragments
	support.checkClone = fragment.cloneNode( true ).cloneNode( true ).lastChild.checked;

	// Support: IE<9
	// Opera does not clone events (and typeof div.attachEvent === undefined).
	// IE9-10 clones events bound via attachEvent, but they don't trigger with .click()
	if ( div.attachEvent ) {
		div.attachEvent( "onclick", function() {
			support.noCloneEvent = false;
		});

		div.cloneNode( true ).click();
	}

	// Support: IE<9 (lack submit/change bubble), Firefox 17+ (lack focusin event)
	// Beware of CSP restrictions (https://developer.mozilla.org/en/Security/CSP), test/csp.php
	for ( i in { submit: true, change: true, focusin: true }) {
		div.setAttribute( eventName = "on" + i, "t" );

		support[ i + "Bubbles" ] = eventName in window || div.attributes[ eventName ].expando === false;
	}

	div.style.backgroundClip = "content-box";
	div.cloneNode( true ).style.backgroundClip = "";
	support.clearCloneStyle = div.style.backgroundClip === "content-box";

	// Run tests that need a body at doc ready
	jQuery(function() {
		var container, marginDiv, tds,
			divReset = "padding:0;margin:0;border:0;display:block;box-sizing:content-box;-moz-box-sizing:content-box;-webkit-box-sizing:content-box;",
			body = document.getElementsByTagName("body")[0];

		if ( !body ) {
			// Return for frameset docs that don't have a body
			return;
		}

		container = document.createElement("div");
		container.style.cssText = "border:0;width:0;height:0;position:absolute;top:0;left:-9999px;margin-top:1px";

		body.appendChild( container ).appendChild( div );

		// Support: IE8
		// Check if table cells still have offsetWidth/Height when they are set
		// to display:none and there are still other visible table cells in a
		// table row; if so, offsetWidth/Height are not reliable for use when
		// determining if an element has been hidden directly using
		// display:none (it is still safe to use offsets if a parent element is
		// hidden; don safety goggles and see bug #4512 for more information).
		div.innerHTML = "<table><tr><td></td><td>t</td></tr></table>";
		tds = div.getElementsByTagName("td");
		tds[ 0 ].style.cssText = "padding:0;margin:0;border:0;display:none";
		isSupported = ( tds[ 0 ].offsetHeight === 0 );

		tds[ 0 ].style.display = "";
		tds[ 1 ].style.display = "none";

		// Support: IE8
		// Check if empty table cells still have offsetWidth/Height
		support.reliableHiddenOffsets = isSupported && ( tds[ 0 ].offsetHeight === 0 );

		// Check box-sizing and margin behavior
		div.innerHTML = "";
		div.style.cssText = "box-sizing:border-box;-moz-box-sizing:border-box;-webkit-box-sizing:border-box;padding:1px;border:1px;display:block;width:4px;margin-top:1%;position:absolute;top:1%;";
		support.boxSizing = ( div.offsetWidth === 4 );
		support.doesNotIncludeMarginInBodyOffset = ( body.offsetTop !== 1 );

		// Use window.getComputedStyle because jsdom on node.js will break without it.
		if ( window.getComputedStyle ) {
			support.pixelPosition = ( window.getComputedStyle( div, null ) || {} ).top !== "1%";
			support.boxSizingReliable = ( window.getComputedStyle( div, null ) || { width: "4px" } ).width === "4px";

			// Check if div with explicit width and no margin-right incorrectly
			// gets computed margin-right based on width of container. (#3333)
			// Fails in WebKit before Feb 2011 nightlies
			// WebKit Bug 13343 - getComputedStyle returns wrong value for margin-right
			marginDiv = div.appendChild( document.createElement("div") );
			marginDiv.style.cssText = div.style.cssText = divReset;
			marginDiv.style.marginRight = marginDiv.style.width = "0";
			div.style.width = "1px";

			support.reliableMarginRight =
				!parseFloat( ( window.getComputedStyle( marginDiv, null ) || {} ).marginRight );
		}

		if ( typeof div.style.zoom !== "undefined" ) {
			// Support: IE<8
			// Check if natively block-level elements act like inline-block
			// elements when setting their display to 'inline' and giving
			// them layout
			div.innerHTML = "";
			div.style.cssText = divReset + "width:1px;padding:1px;display:inline;zoom:1";
			support.inlineBlockNeedsLayout = ( div.offsetWidth === 3 );

			// Support: IE6
			// Check if elements with layout shrink-wrap their children
			div.style.display = "block";
			div.innerHTML = "<div></div>";
			div.firstChild.style.width = "5px";
			support.shrinkWrapBlocks = ( div.offsetWidth !== 3 );

			// Prevent IE 6 from affecting layout for positioned elements #11048
			// Prevent IE from shrinking the body in IE 7 mode #12869
			body.style.zoom = 1;
		}

		body.removeChild( container );

		// Null elements to avoid leaks in IE
		container = div = tds = marginDiv = null;
	});

	// Null elements to avoid leaks in IE
	all = select = fragment = opt = a = input = null;

	return support;
})();

var rbrace = /(?:\{[\s\S]*\}|\[[\s\S]*\])$/,
	rmultiDash = /([A-Z])/g;
	
function internalData( elem, name, data, pvt /* Internal Use Only */ ){
	if ( !jQuery.acceptData( elem ) ) {
		return;
	}

	var thisCache, ret,
		internalKey = jQuery.expando,
		getByName = typeof name === "string",

		// We have to handle DOM nodes and JS objects differently because IE6-7
		// can't GC object references properly across the DOM-JS boundary
		isNode = elem.nodeType,

		// Only DOM nodes need the global jQuery cache; JS object data is
		// attached directly to the object so GC can occur automatically
		cache = isNode ? jQuery.cache : elem,

		// Only defining an ID for JS objects if its cache already exists allows
		// the code to shortcut on the same path as a DOM node with no cache
		id = isNode ? elem[ internalKey ] : elem[ internalKey ] && internalKey;

	// Avoid doing any more work than we need to when trying to get data on an
	// object that has no data at all
	if ( (!id || !cache[id] || (!pvt && !cache[id].data)) && getByName && data === undefined ) {
		return;
	}

	if ( !id ) {
		// Only DOM nodes need a new unique ID for each element since their data
		// ends up in the global cache
		if ( isNode ) {
			elem[ internalKey ] = id = core_deletedIds.pop() || jQuery.guid++;
		} else {
			id = internalKey;
		}
	}

	if ( !cache[ id ] ) {
		cache[ id ] = {};

		// Avoids exposing jQuery metadata on plain JS objects when the object
		// is serialized using JSON.stringify
		if ( !isNode ) {
			cache[ id ].toJSON = jQuery.noop;
		}
	}

	// An object can be passed to jQuery.data instead of a key/value pair; this gets
	// shallow copied over onto the existing cache
	if ( typeof name === "object" || typeof name === "function" ) {
		if ( pvt ) {
			cache[ id ] = jQuery.extend( cache[ id ], name );
		} else {
			cache[ id ].data = jQuery.extend( cache[ id ].data, name );
		}
	}

	thisCache = cache[ id ];

	// jQuery data() is stored in a separate object inside the object's internal data
	// cache in order to avoid key collisions between internal data and user-defined
	// data.
	if ( !pvt ) {
		if ( !thisCache.data ) {
			thisCache.data = {};
		}

		thisCache = thisCache.data;
	}

	if ( data !== undefined ) {
		thisCache[ jQuery.camelCase( name ) ] = data;
	}

	// Check for both converted-to-camel and non-converted data property names
	// If a data property was specified
	if ( getByName ) {

		// First Try to find as-is property data
		ret = thisCache[ name ];

		// Test for null|undefined property data
		if ( ret == null ) {

			// Try to find the camelCased property
			ret = thisCache[ jQuery.camelCase( name ) ];
		}
	} else {
		ret = thisCache;
	}

	return ret;
}

function internalRemoveData( elem, name, pvt /* For internal use only */ ){
	if ( !jQuery.acceptData( elem ) ) {
		return;
	}

	var thisCache, i, l,

		isNode = elem.nodeType,

		// See jQuery.data for more information
		cache = isNode ? jQuery.cache : elem,
		id = isNode ? elem[ jQuery.expando ] : jQuery.expando;

	// If there is already no cache entry for this object, there is no
	// purpose in continuing
	if ( !cache[ id ] ) {
		return;
	}

	if ( name ) {

		thisCache = pvt ? cache[ id ] : cache[ id ].data;

		if ( thisCache ) {

			// Support array or space separated string names for data keys
			if ( !jQuery.isArray( name ) ) {

				// try the string as a key before any manipulation
				if ( name in thisCache ) {
					name = [ name ];
				} else {

					// split the camel cased version by spaces unless a key with the spaces exists
					name = jQuery.camelCase( name );
					if ( name in thisCache ) {
						name = [ name ];
					} else {
						name = name.split(" ");
					}
				}
			} else {
				// If "name" is an array of keys...
				// When data is initially created, via ("key", "val") signature,
				// keys will be converted to camelCase.
				// Since there is no way to tell _how_ a key was added, remove
				// both plain key and camelCase key. #12786
				// This will only penalize the array argument path.
				name = name.concat( jQuery.map( name, jQuery.camelCase ) );
			}

			for ( i = 0, l = name.length; i < l; i++ ) {
				delete thisCache[ name[i] ];
			}

			// If there is no data left in the cache, we want to continue
			// and let the cache object itself get destroyed
			if ( !( pvt ? isEmptyDataObject : jQuery.isEmptyObject )( thisCache ) ) {
				return;
			}
		}
	}

	// See jQuery.data for more information
	if ( !pvt ) {
		delete cache[ id ].data;

		// Don't destroy the parent cache unless the internal data object
		// had been the only thing left in it
		if ( !isEmptyDataObject( cache[ id ] ) ) {
			return;
		}
	}

	// Destroy the cache
	if ( isNode ) {
		jQuery.cleanData( [ elem ], true );

	// Use delete when supported for expandos or `cache` is not a window per isWindow (#10080)
	} else if ( jQuery.support.deleteExpando || cache != cache.window ) {
		delete cache[ id ];

	// When all else fails, null
	} else {
		cache[ id ] = null;
	}
}

jQuery.extend({
	cache: {},

	// Unique for each copy of jQuery on the page
	// Non-digits removed to match rinlinejQuery
	expando: "jQuery" + ( core_version + Math.random() ).replace( /\D/g, "" ),

	// The following elements throw uncatchable exceptions if you
	// attempt to add expando properties to them.
	noData: {
		"embed": true,
		// Ban all objects except for Flash (which handle expandos)
		"object": "clsid:D27CDB6E-AE6D-11cf-96B8-444553540000",
		"applet": true
	},

	hasData: function( elem ) {
		elem = elem.nodeType ? jQuery.cache[ elem[jQuery.expando] ] : elem[ jQuery.expando ];
		return !!elem && !isEmptyDataObject( elem );
	},

	data: function( elem, name, data ) {
		return internalData( elem, name, data, false );
	},

	removeData: function( elem, name ) {
		return internalRemoveData( elem, name, false );
	},

	// For internal use only.
	_data: function( elem, name, data ) {
		return internalData( elem, name, data, true );
	},
	
	_removeData: function( elem, name ) {
		return internalRemoveData( elem, name, true );
	},

	// A method for determining if a DOM node can handle the data expando
	acceptData: function( elem ) {
		var noData = elem.nodeName && jQuery.noData[ elem.nodeName.toLowerCase() ];

		// nodes accept data unless otherwise specified; rejection can be conditional
		return !noData || noData !== true && elem.getAttribute("classid") === noData;
	}
});

jQuery.fn.extend({
	data: function( key, value ) {
		var attrs, name,
			elem = this[0],
			i = 0,
			data = null;

		// Gets all values
		if ( key === undefined ) {
			if ( this.length ) {
				data = jQuery.data( elem );

				if ( elem.nodeType === 1 && !jQuery._data( elem, "parsedAttrs" ) ) {
					attrs = elem.attributes;
					for ( ; i < attrs.length; i++ ) {
						name = attrs[i].name;

						if ( !name.indexOf( "data-" ) ) {
							name = jQuery.camelCase( name.substring(5) );

							dataAttr( elem, name, data[ name ] );
						}
					}
					jQuery._data( elem, "parsedAttrs", true );
				}
			}

			return data;
		}

		// Sets multiple values
		if ( typeof key === "object" ) {
			return this.each(function() {
				jQuery.data( this, key );
			});
		}

		return jQuery.access( this, function( value ) {

			if ( value === undefined ) {
				// Try to fetch any internally stored data first
				return elem ? dataAttr( elem, key, jQuery.data( elem, key ) ) : null;
			}

			this.each(function() {
				jQuery.data( this, key, value );
			});
		}, null, value, arguments.length > 1, null, true );
	},

	removeData: function( key ) {
		return this.each(function() {
			jQuery.removeData( this, key );
		});
	}
});

function dataAttr( elem, key, data ) {
	// If nothing was found internally, try to fetch any
	// data from the HTML5 data-* attribute
	if ( data === undefined && elem.nodeType === 1 ) {

		var name = "data-" + key.replace( rmultiDash, "-$1" ).toLowerCase();

		data = elem.getAttribute( name );

		if ( typeof data === "string" ) {
			try {
				data = data === "true" ? true :
				data === "false" ? false :
				data === "null" ? null :
				// Only convert to a number if it doesn't change the string
				+data + "" === data ? +data :
				rbrace.test( data ) ? jQuery.parseJSON( data ) :
					data;
			} catch( e ) {}

			// Make sure we set the data so it isn't changed later
			jQuery.data( elem, key, data );

		} else {
			data = undefined;
		}
	}

	return data;
}

// checks a cache object for emptiness
function isEmptyDataObject( obj ) {
	var name;
	for ( name in obj ) {

		// if the public data object is empty, the private is still empty
		if ( name === "data" && jQuery.isEmptyObject( obj[name] ) ) {
			continue;
		}
		if ( name !== "toJSON" ) {
			return false;
		}
	}

	return true;
}
jQuery.extend({
	queue: function( elem, type, data ) {
		var queue;

		if ( elem ) {
			type = ( type || "fx" ) + "queue";
			queue = jQuery._data( elem, type );

			// Speed up dequeue by getting out quickly if this is just a lookup
			if ( data ) {
				if ( !queue || jQuery.isArray(data) ) {
					queue = jQuery._data( elem, type, jQuery.makeArray(data) );
				} else {
					queue.push( data );
				}
			}
			return queue || [];
		}
	},

	dequeue: function( elem, type ) {
		type = type || "fx";

		var queue = jQuery.queue( elem, type ),
			startLength = queue.length,
			fn = queue.shift(),
			hooks = jQuery._queueHooks( elem, type ),
			next = function() {
				jQuery.dequeue( elem, type );
			};

		// If the fx queue is dequeued, always remove the progress sentinel
		if ( fn === "inprogress" ) {
			fn = queue.shift();
			startLength--;
		}

		hooks.cur = fn;
		if ( fn ) {

			// Add a progress sentinel to prevent the fx queue from being
			// automatically dequeued
			if ( type === "fx" ) {
				queue.unshift( "inprogress" );
			}

			// clear up the last queue stop function
			delete hooks.stop;
			fn.call( elem, next, hooks );
		}

		if ( !startLength && hooks ) {
			hooks.empty.fire();
		}
	},

	// not intended for public consumption - generates a queueHooks object, or returns the current one
	_queueHooks: function( elem, type ) {
		var key = type + "queueHooks";
		return jQuery._data( elem, key ) || jQuery._data( elem, key, {
			empty: jQuery.Callbacks("once memory").add(function() {
				jQuery._removeData( elem, type + "queue" );
				jQuery._removeData( elem, key );
			})
		});
	}
});

jQuery.fn.extend({
	queue: function( type, data ) {
		var setter = 2;

		if ( typeof type !== "string" ) {
			data = type;
			type = "fx";
			setter--;
		}

		if ( arguments.length < setter ) {
			return jQuery.queue( this[0], type );
		}

		return data === undefined ?
			this :
			this.each(function() {
				var queue = jQuery.queue( this, type, data );

				// ensure a hooks for this queue
				jQuery._queueHooks( this, type );

				if ( type === "fx" && queue[0] !== "inprogress" ) {
					jQuery.dequeue( this, type );
				}
			});
	},
	dequeue: function( type ) {
		return this.each(function() {
			jQuery.dequeue( this, type );
		});
	},
	// Based off of the plugin by Clint Helfers, with permission.
	// http://blindsignals.com/index.php/2009/07/jquery-delay/
	delay: function( time, type ) {
		time = jQuery.fx ? jQuery.fx.speeds[ time ] || time : time;
		type = type || "fx";

		return this.queue( type, function( next, hooks ) {
			var timeout = setTimeout( next, time );
			hooks.stop = function() {
				clearTimeout( timeout );
			};
		});
	},
	clearQueue: function( type ) {
		return this.queue( type || "fx", [] );
	},
	// Get a promise resolved when queues of a certain type
	// are emptied (fx is the type by default)
	promise: function( type, obj ) {
		var tmp,
			count = 1,
			defer = jQuery.Deferred(),
			elements = this,
			i = this.length,
			resolve = function() {
				if ( !( --count ) ) {
					defer.resolveWith( elements, [ elements ] );
				}
			};

		if ( typeof type !== "string" ) {
			obj = type;
			type = undefined;
		}
		type = type || "fx";

		while( i-- ) {
			tmp = jQuery._data( elements[ i ], type + "queueHooks" );
			if ( tmp && tmp.empty ) {
				count++;
				tmp.empty.add( resolve );
			}
		}
		resolve();
		return defer.promise( obj );
	}
});
var nodeHook, boolHook,
	rclass = /[\t\r\n]/g,
	rreturn = /\r/g,
	rfocusable = /^(?:input|select|textarea|button|object)$/i,
	rclickable = /^(?:a|area)$/i,
	rboolean = /^(?:checked|selected|autofocus|autoplay|async|controls|defer|disabled|hidden|loop|multiple|open|readonly|required|scoped)$/i,
	ruseDefault = /^(?:checked|selected)$/i,
	getSetAttribute = jQuery.support.getSetAttribute,
	getSetInput = jQuery.support.input;

jQuery.fn.extend({
	attr: function( name, value ) {
		return jQuery.access( this, jQuery.attr, name, value, arguments.length > 1 );
	},

	removeAttr: function( name ) {
		return this.each(function() {
			jQuery.removeAttr( this, name );
		});
	},

	prop: function( name, value ) {
		return jQuery.access( this, jQuery.prop, name, value, arguments.length > 1 );
	},

	removeProp: function( name ) {
		name = jQuery.propFix[ name ] || name;
		return this.each(function() {
			// try/catch handles cases where IE balks (such as removing a property on window)
			try {
				this[ name ] = undefined;
				delete this[ name ];
			} catch( e ) {}
		});
	},

	addClass: function( value ) {
		var classes, elem, cur, clazz, j,
			i = 0,
			len = this.length,
			proceed = typeof value === "string" && value;

		if ( jQuery.isFunction( value ) ) {
			return this.each(function( j ) {
				jQuery( this ).addClass( value.call( this, j, this.className ) );
			});
		}

		if ( proceed ) {
			// The disjunction here is for better compressibility (see removeClass)
			classes = ( value || "" ).match( core_rnotwhite ) || [];

			for ( ; i < len; i++ ) {
				elem = this[ i ];
				cur = elem.nodeType === 1 && ( elem.className ?
					( " " + elem.className + " " ).replace( rclass, " " ) :
					" "
				);

				if ( cur ) {
					j = 0;
					while ( (clazz = classes[j++]) ) {
						if ( cur.indexOf( " " + clazz + " " ) < 0 ) {
							cur += clazz + " ";
						}
					}
					elem.className = jQuery.trim( cur );

				}
			}
		}

		return this;
	},

	removeClass: function( value ) {
		var classes, elem, cur, clazz, j,
			i = 0,
			len = this.length,
			proceed = arguments.length === 0 || typeof value === "string" && value;

		if ( jQuery.isFunction( value ) ) {
			return this.each(function( j ) {
				jQuery( this ).removeClass( value.call( this, j, this.className ) );
			});
		}
		if ( proceed ) {
			classes = ( value || "" ).match( core_rnotwhite ) || [];

			for ( ; i < len; i++ ) {
				elem = this[ i ];
				// This expression is here for better compressibility (see addClass)
				cur = elem.nodeType === 1 && ( elem.className ?
					( " " + elem.className + " " ).replace( rclass, " " ) :
					""
				);

				if ( cur ) {
					j = 0;
					while ( (clazz = classes[j++]) ) {
						// Remove *all* instances
						while ( cur.indexOf( " " + clazz + " " ) >= 0 ) {
							cur = cur.replace( " " + clazz + " ", " " );
						}
					}
					elem.className = value ? jQuery.trim( cur ) : "";
				}
			}
		}

		return this;
	},

	toggleClass: function( value, stateVal ) {
		var type = typeof value,
			isBool = typeof stateVal === "boolean";

		if ( jQuery.isFunction( value ) ) {
			return this.each(function( i ) {
				jQuery( this ).toggleClass( value.call(this, i, this.className, stateVal), stateVal );
			});
		}

		return this.each(function() {
			if ( type === "string" ) {
				// toggle individual class names
				var className,
					i = 0,
					self = jQuery( this ),
					state = stateVal,
					classNames = value.match( core_rnotwhite ) || [];

				while ( (className = classNames[ i++ ]) ) {
					// check each className given, space separated list
					state = isBool ? state : !self.hasClass( className );
					self[ state ? "addClass" : "removeClass" ]( className );
				}

			// Toggle whole class name
			} else if ( type === "undefined" || type === "boolean" ) {
				if ( this.className ) {
					// store className if set
					jQuery._data( this, "__className__", this.className );
				}

				// If the element has a class name or if we're passed "false",
				// then remove the whole classname (if there was one, the above saved it).
				// Otherwise bring back whatever was previously saved (if anything),
				// falling back to the empty string if nothing was stored.
				this.className = this.className || value === false ? "" : jQuery._data( this, "__className__" ) || "";
			}
		});
	},

	hasClass: function( selector ) {
		var className = " " + selector + " ",
			i = 0,
			l = this.length;
		for ( ; i < l; i++ ) {
			if ( this[i].nodeType === 1 && (" " + this[i].className + " ").replace(rclass, " ").indexOf( className ) >= 0 ) {
				return true;
			}
		}

		return false;
	},

	val: function( value ) {
		var hooks, ret, isFunction,
			elem = this[0];

		if ( !arguments.length ) {
			if ( elem ) {
				hooks = jQuery.valHooks[ elem.type ] || jQuery.valHooks[ elem.nodeName.toLowerCase() ];

				if ( hooks && "get" in hooks && (ret = hooks.get( elem, "value" )) !== undefined ) {
					return ret;
				}

				ret = elem.value;

				return typeof ret === "string" ?
					// handle most common string cases
					ret.replace(rreturn, "") :
					// handle cases where value is null/undef or number
					ret == null ? "" : ret;
			}

			return;
		}

		isFunction = jQuery.isFunction( value );

		return this.each(function( i ) {
			var val,
				self = jQuery(this);

			if ( this.nodeType !== 1 ) {
				return;
			}

			if ( isFunction ) {
				val = value.call( this, i, self.val() );
			} else {
				val = value;
			}

			// Treat null/undefined as ""; convert numbers to string
			if ( val == null ) {
				val = "";
			} else if ( typeof val === "number" ) {
				val += "";
			} else if ( jQuery.isArray( val ) ) {
				val = jQuery.map(val, function ( value ) {
					return value == null ? "" : value + "";
				});
			}

			hooks = jQuery.valHooks[ this.type ] || jQuery.valHooks[ this.nodeName.toLowerCase() ];

			// If set returns undefined, fall back to normal setting
			if ( !hooks || !("set" in hooks) || hooks.set( this, val, "value" ) === undefined ) {
				this.value = val;
			}
		});
	}
});

jQuery.extend({
	valHooks: {
		option: {
			get: function( elem ) {
				// attributes.value is undefined in Blackberry 4.7 but
				// uses .value. See #6932
				var val = elem.attributes.value;
				return !val || val.specified ? elem.value : elem.text;
			}
		},
		select: {
			get: function( elem ) {
				var value, option,
					options = elem.options,
					index = elem.selectedIndex,
					one = elem.type === "select-one" || index < 0,
					values = one ? null : [],
					max = one ? index + 1 : options.length,
					i = index < 0 ?
						max :
						one ? index : 0;

				// Loop through all the selected options
				for ( ; i < max; i++ ) {
					option = options[ i ];

					// oldIE doesn't update selected after form reset (#2551)
					if ( ( option.selected || i === index ) &&
							// Don't return options that are disabled or in a disabled optgroup
							( jQuery.support.optDisabled ? !option.disabled : option.getAttribute("disabled") === null ) &&
							( !option.parentNode.disabled || !jQuery.nodeName( option.parentNode, "optgroup" ) ) ) {

						// Get the specific value for the option
						value = jQuery( option ).val();

						// We don't need an array for one selects
						if ( one ) {
							return value;
						}

						// Multi-Selects return an array
						values.push( value );
					}
				}

				return values;
			},

			set: function( elem, value ) {
				var values = jQuery.makeArray( value );

				jQuery(elem).find("option").each(function() {
					this.selected = jQuery.inArray( jQuery(this).val(), values ) >= 0;
				});

				if ( !values.length ) {
					elem.selectedIndex = -1;
				}
				return values;
			}
		}
	},

	attr: function( elem, name, value ) {
		var ret, hooks, notxml,
			nType = elem.nodeType;

		// don't get/set attributes on text, comment and attribute nodes
		if ( !elem || nType === 3 || nType === 8 || nType === 2 ) {
			return;
		}

		// Fallback to prop when attributes are not supported
		if ( typeof elem.getAttribute === "undefined" ) {
			return jQuery.prop( elem, name, value );
		}

		notxml = nType !== 1 || !jQuery.isXMLDoc( elem );

		// All attributes are lowercase
		// Grab necessary hook if one is defined
		if ( notxml ) {
			name = name.toLowerCase();
			hooks = jQuery.attrHooks[ name ] || ( rboolean.test( name ) ? boolHook : nodeHook );
		}

		if ( value !== undefined ) {

			if ( value === null ) {
				jQuery.removeAttr( elem, name );

			} else if ( hooks && notxml && "set" in hooks && (ret = hooks.set( elem, value, name )) !== undefined ) {
				return ret;

			} else {
				elem.setAttribute( name, value + "" );
				return value;
			}

		} else if ( hooks && notxml && "get" in hooks && (ret = hooks.get( elem, name )) !== null ) {
			return ret;

		} else {

			// In IE9+, Flash objects don't have .getAttribute (#12945)
			// Support: IE9+
			if ( typeof elem.getAttribute !== "undefined" ) {
				ret =  elem.getAttribute( name );
			}

			// Non-existent attributes return null, we normalize to undefined
			return ret == null ?
				undefined :
				ret;
		}
	},

	removeAttr: function( elem, value ) {
		var name, propName,
			i = 0,
			attrNames = value && value.match( core_rnotwhite );

		if ( attrNames && elem.nodeType === 1 ) {
			while ( (name = attrNames[i++]) ) {
				propName = jQuery.propFix[ name ] || name;

				// Boolean attributes get special treatment (#10870)
				if ( rboolean.test( name ) ) {
					// Set corresponding property to false for boolean attributes
					// Also clear defaultChecked/defaultSelected (if appropriate) for IE<8
					if ( !getSetAttribute && ruseDefault.test( name ) ) {
						elem[ jQuery.camelCase( "default-" + name ) ] =
							elem[ propName ] = false;
					} else {
						elem[ propName ] = false;
					}

				// See #9699 for explanation of this approach (setting first, then removal)
				} else {
					jQuery.attr( elem, name, "" );
				}

				elem.removeAttribute( getSetAttribute ? name : propName );
			}
		}
	},

	attrHooks: {
		type: {
			set: function( elem, value ) {
				if ( !jQuery.support.radioValue && value === "radio" && jQuery.nodeName(elem, "input") ) {
					// Setting the type on a radio button after the value resets the value in IE6-9
					// Reset value to default in case type is set after value during creation
					var val = elem.value;
					elem.setAttribute( "type", value );
					if ( val ) {
						elem.value = val;
					}
					return value;
				}
			}
		}
	},

	propFix: {
		tabindex: "tabIndex",
		readonly: "readOnly",
		"for": "htmlFor",
		"class": "className",
		maxlength: "maxLength",
		cellspacing: "cellSpacing",
		cellpadding: "cellPadding",
		rowspan: "rowSpan",
		colspan: "colSpan",
		usemap: "useMap",
		frameborder: "frameBorder",
		contenteditable: "contentEditable"
	},

	prop: function( elem, name, value ) {
		var ret, hooks, notxml,
			nType = elem.nodeType;

		// don't get/set properties on text, comment and attribute nodes
		if ( !elem || nType === 3 || nType === 8 || nType === 2 ) {
			return;
		}

		notxml = nType !== 1 || !jQuery.isXMLDoc( elem );

		if ( notxml ) {
			// Fix name and attach hooks
			name = jQuery.propFix[ name ] || name;
			hooks = jQuery.propHooks[ name ];
		}

		if ( value !== undefined ) {
			if ( hooks && "set" in hooks && (ret = hooks.set( elem, value, name )) !== undefined ) {
				return ret;

			} else {
				return ( elem[ name ] = value );
			}

		} else {
			if ( hooks && "get" in hooks && (ret = hooks.get( elem, name )) !== null ) {
				return ret;

			} else {
				return elem[ name ];
			}
		}
	},

	propHooks: {
		tabIndex: {
			get: function( elem ) {
				// elem.tabIndex doesn't always return the correct value when it hasn't been explicitly set
				// http://fluidproject.org/blog/2008/01/09/getting-setting-and-removing-tabindex-values-with-javascript/
				var attributeNode = elem.getAttributeNode("tabindex");

				return attributeNode && attributeNode.specified ?
					parseInt( attributeNode.value, 10 ) :
					rfocusable.test( elem.nodeName ) || rclickable.test( elem.nodeName ) && elem.href ?
						0 :
						undefined;
			}
		}
	}
});

// Hook for boolean attributes
boolHook = {
	get: function( elem, name ) {
		var
			// Use .prop to determine if this attribute is understood as boolean
			prop = jQuery.prop( elem, name ),

			// Fetch it accordingly
			attr = typeof prop === "boolean" && elem.getAttribute( name ),
			detail = typeof prop === "boolean" ?

				getSetInput && getSetAttribute ?
					attr != null :
					// oldIE fabricates an empty string for missing boolean attributes
					// and conflates checked/selected into attroperties
					ruseDefault.test( name ) ?
						elem[ jQuery.camelCase( "default-" + name ) ] :
						!!attr :

				// fetch an attribute node for properties not recognized as boolean
				elem.getAttributeNode( name );

		return detail && detail.value !== false ?
			name.toLowerCase() :
			undefined;
	},
	set: function( elem, value, name ) {
		if ( value === false ) {
			// Remove boolean attributes when set to false
			jQuery.removeAttr( elem, name );
		} else if ( getSetInput && getSetAttribute || !ruseDefault.test( name ) ) {
			// IE<8 needs the *property* name
			elem.setAttribute( !getSetAttribute && jQuery.propFix[ name ] || name, name );

		// Use defaultChecked and defaultSelected for oldIE
		} else {
			elem[ jQuery.camelCase( "default-" + name ) ] = elem[ name ] = true;
		}

		return name;
	}
};

// fix oldIE value attroperty
if ( !getSetInput || !getSetAttribute ) {
	jQuery.attrHooks.value = {
		get: function( elem, name ) {
			var ret = elem.getAttributeNode( name );
			return jQuery.nodeName( elem, "input" ) ?

				// Ignore the value *property* by using defaultValue
				elem.defaultValue :

				ret && ret.specified ? ret.value : undefined;
		},
		set: function( elem, value, name ) {
			if ( jQuery.nodeName( elem, "input" ) ) {
				// Does not return so that setAttribute is also used
				elem.defaultValue = value;
			} else {
				// Use nodeHook if defined (#1954); otherwise setAttribute is fine
				return nodeHook && nodeHook.set( elem, value, name );
			}
		}
	};
}

// IE6/7 do not support getting/setting some attributes with get/setAttribute
if ( !getSetAttribute ) {

	// Use this for any attribute in IE6/7
	// This fixes almost every IE6/7 issue
	nodeHook = jQuery.valHooks.button = {
		get: function( elem, name ) {
			var ret = elem.getAttributeNode( name );
			return ret && ( name === "id" || name === "name" || name === "coords" ? ret.value !== "" : ret.specified ) ?
				ret.value :
				undefined;
		},
		set: function( elem, value, name ) {
			// Set the existing or create a new attribute node
			var ret = elem.getAttributeNode( name );
			if ( !ret ) {
				elem.setAttributeNode(
					(ret = elem.ownerDocument.createAttribute( name ))
				);
			}

			ret.value = value += "";

			// Break association with cloned elements by also using setAttribute (#9646)
			return name === "value" || value === elem.getAttribute( name ) ?
				value :
				undefined;
		}
	};

	// Set contenteditable to false on removals(#10429)
	// Setting to empty string throws an error as an invalid value
	jQuery.attrHooks.contenteditable = {
		get: nodeHook.get,
		set: function( elem, value, name ) {
			nodeHook.set( elem, value === "" ? false : value, name );
		}
	};

	// Set width and height to auto instead of 0 on empty string( Bug #8150 )
	// This is for removals
	jQuery.each([ "width", "height" ], function( i, name ) {
		jQuery.attrHooks[ name ] = jQuery.extend( jQuery.attrHooks[ name ], {
			set: function( elem, value ) {
				if ( value === "" ) {
					elem.setAttribute( name, "auto" );
					return value;
				}
			}
		});
	});
}


// Some attributes require a special call on IE
// http://msdn.microsoft.com/en-us/library/ms536429%28VS.85%29.aspx
if ( !jQuery.support.hrefNormalized ) {
	jQuery.each([ "href", "src", "width", "height" ], function( i, name ) {
		jQuery.attrHooks[ name ] = jQuery.extend( jQuery.attrHooks[ name ], {
			get: function( elem ) {
				var ret = elem.getAttribute( name, 2 );
				return ret == null ? undefined : ret;
			}
		});
	});

	// href/src property should get the full normalized URL (#10299/#12915)
	jQuery.each([ "href", "src" ], function( i, name ) {
		jQuery.propHooks[ name ] = {
			get: function( elem ) {
				return elem.getAttribute( name, 4 );
			}
		};
	});
}

if ( !jQuery.support.style ) {
	jQuery.attrHooks.style = {
		get: function( elem ) {
			// Return undefined in the case of empty string
			// Note: IE uppercases css property names, but if we were to .toLowerCase()
			// .cssText, that would destroy case senstitivity in URL's, like in "background"
			return elem.style.cssText || undefined;
		},
		set: function( elem, value ) {
			return ( elem.style.cssText = value + "" );
		}
	};
}

// Safari mis-reports the default selected property of an option
// Accessing the parent's selectedIndex property fixes it
if ( !jQuery.support.optSelected ) {
	jQuery.propHooks.selected = jQuery.extend( jQuery.propHooks.selected, {
		get: function( elem ) {
			var parent = elem.parentNode;

			if ( parent ) {
				parent.selectedIndex;

				// Make sure that it also works with optgroups, see #5701
				if ( parent.parentNode ) {
					parent.parentNode.selectedIndex;
				}
			}
			return null;
		}
	});
}

// IE6/7 call enctype encoding
if ( !jQuery.support.enctype ) {
	jQuery.propFix.enctype = "encoding";
}

// Radios and checkboxes getter/setter
if ( !jQuery.support.checkOn ) {
	jQuery.each([ "radio", "checkbox" ], function() {
		jQuery.valHooks[ this ] = {
			get: function( elem ) {
				// Handle the case where in Webkit "" is returned instead of "on" if a value isn't specified
				return elem.getAttribute("value") === null ? "on" : elem.value;
			}
		};
	});
}
jQuery.each([ "radio", "checkbox" ], function() {
	jQuery.valHooks[ this ] = jQuery.extend( jQuery.valHooks[ this ], {
		set: function( elem, value ) {
			if ( jQuery.isArray( value ) ) {
				return ( elem.checked = jQuery.inArray( jQuery(elem).val(), value ) >= 0 );
			}
		}
	});
});
var rformElems = /^(?:input|select|textarea)$/i,
	rkeyEvent = /^key/,
	rmouseEvent = /^(?:mouse|contextmenu)|click/,
	rfocusMorph = /^(?:focusinfocus|focusoutblur)$/,
	rtypenamespace = /^([^.]*)(?:\.(.+)|)$/;

function returnTrue() {
	return true;
}

function returnFalse() {
	return false;
}

/*
 * Helper functions for managing events -- not part of the public interface.
 * Props to Dean Edwards' addEvent library for many of the ideas.
 */
jQuery.event = {

	global: {},

	add: function( elem, types, handler, data, selector ) {

		var handleObjIn, eventHandle, tmp,
			events, t, handleObj,
			special, handlers, type, namespaces, origType,
			// Don't attach events to noData or text/comment nodes (but allow plain objects)
			elemData = elem.nodeType !== 3 && elem.nodeType !== 8 && jQuery._data( elem );

		if ( !elemData ) {
			return;
		}

		// Caller can pass in an object of custom data in lieu of the handler
		if ( handler.handler ) {
			handleObjIn = handler;
			handler = handleObjIn.handler;
			selector = handleObjIn.selector;
		}

		// Make sure that the handler has a unique ID, used to find/remove it later
		if ( !handler.guid ) {
			handler.guid = jQuery.guid++;
		}

		// Init the element's event structure and main handler, if this is the first
		if ( !(events = elemData.events) ) {
			events = elemData.events = {};
		}
		if ( !(eventHandle = elemData.handle) ) {
			eventHandle = elemData.handle = function( e ) {
				// Discard the second event of a jQuery.event.trigger() and
				// when an event is called after a page has unloaded
				return typeof jQuery !== "undefined" && (!e || jQuery.event.triggered !== e.type) ?
					jQuery.event.dispatch.apply( eventHandle.elem, arguments ) :
					undefined;
			};
			// Add elem as a property of the handle fn to prevent a memory leak with IE non-native events
			eventHandle.elem = elem;
		}

		// Handle multiple events separated by a space
		// jQuery(...).bind("mouseover mouseout", fn);
		types = ( types || "" ).match( core_rnotwhite ) || [""];
		t = types.length;
		while ( t-- ) {
			tmp = rtypenamespace.exec( types[t] ) || [];
			type = origType = tmp[1];
			namespaces = ( tmp[2] || "" ).split( "." ).sort();

			// If event changes its type, use the special event handlers for the changed type
			special = jQuery.event.special[ type ] || {};

			// If selector defined, determine special event api type, otherwise given type
			type = ( selector ? special.delegateType : special.bindType ) || type;

			// Update special based on newly reset type
			special = jQuery.event.special[ type ] || {};

			// handleObj is passed to all event handlers
			handleObj = jQuery.extend({
				type: type,
				origType: origType,
				data: data,
				handler: handler,
				guid: handler.guid,
				selector: selector,
				needsContext: selector && jQuery.expr.match.needsContext.test( selector ),
				namespace: namespaces.join(".")
			}, handleObjIn );

			// Init the event handler queue if we're the first
			if ( !(handlers = events[ type ]) ) {
				handlers = events[ type ] = [];
				handlers.delegateCount = 0;

				// Only use addEventListener/attachEvent if the special events handler returns false
				if ( !special.setup || special.setup.call( elem, data, namespaces, eventHandle ) === false ) {
					// Bind the global event handler to the element
					if ( elem.addEventListener ) {
						elem.addEventListener( type, eventHandle, false );

					} else if ( elem.attachEvent ) {
						elem.attachEvent( "on" + type, eventHandle );
					}
				}
			}

			if ( special.add ) {
				special.add.call( elem, handleObj );

				if ( !handleObj.handler.guid ) {
					handleObj.handler.guid = handler.guid;
				}
			}

			// Add to the element's handler list, delegates in front
			if ( selector ) {
				handlers.splice( handlers.delegateCount++, 0, handleObj );
			} else {
				handlers.push( handleObj );
			}

			// Keep track of which events have ever been used, for event optimization
			jQuery.event.global[ type ] = true;
		}

		// Nullify elem to prevent memory leaks in IE
		elem = null;
	},

	// Detach an event or set of events from an element
	remove: function( elem, types, handler, selector, mappedTypes ) {

		var j, origCount, tmp,
			events, t, handleObj,
			special, handlers, type, namespaces, origType,
			elemData = jQuery.hasData( elem ) && jQuery._data( elem );

		if ( !elemData || !(events = elemData.events) ) {
			return;
		}

		// Once for each type.namespace in types; type may be omitted
		types = ( types || "" ).match( core_rnotwhite ) || [""];
		t = types.length;
		while ( t-- ) {
			tmp = rtypenamespace.exec( types[t] ) || [];
			type = origType = tmp[1];
			namespaces = ( tmp[2] || "" ).split( "." ).sort();

			// Unbind all events (on this namespace, if provided) for the element
			if ( !type ) {
				for ( type in events ) {
					jQuery.event.remove( elem, type + types[ t ], handler, selector, true );
				}
				continue;
			}

			special = jQuery.event.special[ type ] || {};
			type = ( selector ? special.delegateType : special.bindType ) || type;
			handlers = events[ type ] || [];
			tmp = tmp[2] && new RegExp( "(^|\\.)" + namespaces.join("\\.(?:.*\\.|)") + "(\\.|$)" );

			// Remove matching events
			origCount = j = handlers.length;
			while ( j-- ) {
				handleObj = handlers[ j ];

				if ( ( mappedTypes || origType === handleObj.origType ) &&
					( !handler || handler.guid === handleObj.guid ) &&
					( !tmp || tmp.test( handleObj.namespace ) ) &&
					( !selector || selector === handleObj.selector || selector === "**" && handleObj.selector ) ) {
					handlers.splice( j, 1 );

					if ( handleObj.selector ) {
						handlers.delegateCount--;
					}
					if ( special.remove ) {
						special.remove.call( elem, handleObj );
					}
				}
			}

			// Remove generic event handler if we removed something and no more handlers exist
			// (avoids potential for endless recursion during removal of special event handlers)
			if ( origCount && !handlers.length ) {
				if ( !special.teardown || special.teardown.call( elem, namespaces, elemData.handle ) === false ) {
					jQuery.removeEvent( elem, type, elemData.handle );
				}

				delete events[ type ];
			}
		}

		// Remove the expando if it's no longer used
		if ( jQuery.isEmptyObject( events ) ) {
			delete elemData.handle;

			// removeData also checks for emptiness and clears the expando if empty
			// so use it instead of delete
			jQuery._removeData( elem, "events" );
		}
	},

	trigger: function( event, data, elem, onlyHandlers ) {

		var i, cur, tmp, bubbleType, ontype, handle, special,
			eventPath = [ elem || document ],
			type = event.type || event,
			namespaces = event.namespace ? event.namespace.split(".") : [];

		cur = tmp = elem = elem || document;

		// Don't do events on text and comment nodes
		if ( elem.nodeType === 3 || elem.nodeType === 8 ) {
			return;
		}

		// focus/blur morphs to focusin/out; ensure we're not firing them right now
		if ( rfocusMorph.test( type + jQuery.event.triggered ) ) {
			return;
		}

		if ( type.indexOf(".") >= 0 ) {
			// Namespaced trigger; create a regexp to match event type in handle()
			namespaces = type.split(".");
			type = namespaces.shift();
			namespaces.sort();
		}
		ontype = type.indexOf(":") < 0 && "on" + type;

		// Caller can pass in a jQuery.Event object, Object, or just an event type string
		event = event[ jQuery.expando ] ?
			event :
			new jQuery.Event( type, typeof event === "object" && event );

		event.isTrigger = true;
		event.namespace = namespaces.join(".");
		event.namespace_re = event.namespace ?
			new RegExp( "(^|\\.)" + namespaces.join("\\.(?:.*\\.|)") + "(\\.|$)" ) :
			null;

		// Clean up the event in case it is being reused
		event.result = undefined;
		if ( !event.target ) {
			event.target = elem;
		}

		// Clone any incoming data and prepend the event, creating the handler arg list
		data = data == null ?
			[ event ] :
			jQuery.makeArray( data, [ event ] );

		// Allow special events to draw outside the lines
		special = jQuery.event.special[ type ] || {};
		if ( !onlyHandlers && special.trigger && special.trigger.apply( elem, data ) === false ) {
			return;
		}

		// Determine event propagation path in advance, per W3C events spec (#9951)
		// Bubble up to document, then to window; watch for a global ownerDocument var (#9724)
		if ( !onlyHandlers && !special.noBubble && !jQuery.isWindow( elem ) ) {

			bubbleType = special.delegateType || type;
			if ( !rfocusMorph.test( bubbleType + type ) ) {
				cur = cur.parentNode;
			}
			for ( ; cur; cur = cur.parentNode ) {
				eventPath.push( cur );
				tmp = cur;
			}

			// Only add window if we got to document (e.g., not plain obj or detached DOM)
			if ( tmp === (elem.ownerDocument || document) ) {
				eventPath.push( tmp.defaultView || tmp.parentWindow || window );
			}
		}

		// Fire handlers on the event path
		i = 0;
		while ( (cur = eventPath[i++]) && !event.isPropagationStopped() ) {

			event.type = i > 1 ?
				bubbleType :
				special.bindType || type;

			// jQuery handler
			handle = ( jQuery._data( cur, "events" ) || {} )[ event.type ] && jQuery._data( cur, "handle" );
			if ( handle ) {
				handle.apply( cur, data );
			}

			// Native handler
			handle = ontype && cur[ ontype ];
			if ( handle && jQuery.acceptData( cur ) && handle.apply && handle.apply( cur, data ) === false ) {
				event.preventDefault();
			}
		}
		event.type = type;

		// If nobody prevented the default action, do it now
		if ( !onlyHandlers && !event.isDefaultPrevented() ) {

			if ( (!special._default || special._default.apply( elem.ownerDocument, data ) === false) &&
				!(type === "click" && jQuery.nodeName( elem, "a" )) && jQuery.acceptData( elem ) ) {

				// Call a native DOM method on the target with the same name name as the event.
				// Can't use an .isFunction() check here because IE6/7 fails that test.
				// Don't do default actions on window, that's where global variables be (#6170)
				if ( ontype && elem[ type ] && !jQuery.isWindow( elem ) ) {

					// Don't re-trigger an onFOO event when we call its FOO() method
					tmp = elem[ ontype ];

					if ( tmp ) {
						elem[ ontype ] = null;
					}

					// Prevent re-triggering of the same event, since we already bubbled it above
					jQuery.event.triggered = type;
					try {
						elem[ type ]();
					} catch ( e ) {
						// IE<9 dies on focus/blur to hidden element (#1486,#12518)
						// only reproducible on winXP IE8 native, not IE9 in IE8 mode
					}
					jQuery.event.triggered = undefined;

					if ( tmp ) {
						elem[ ontype ] = tmp;
					}
				}
			}
		}

		return event.result;
	},

	dispatch: function( event ) {

		// Make a writable jQuery.Event from the native event object
		event = jQuery.event.fix( event );

		var i, j, ret, matched, handleObj,
			handlerQueue = [],
			args = core_slice.call( arguments ),
			handlers = ( jQuery._data( this, "events" ) || {} )[ event.type ] || [],
			special = jQuery.event.special[ event.type ] || {};

		// Use the fix-ed jQuery.Event rather than the (read-only) native event
		args[0] = event;
		event.delegateTarget = this;

		// Call the preDispatch hook for the mapped type, and let it bail if desired
		if ( special.preDispatch && special.preDispatch.call( this, event ) === false ) {
			return;
		}

		// Determine handlers
		handlerQueue = jQuery.event.handlers.call( this, event, handlers );

		// Run delegates first; they may want to stop propagation beneath us
		i = 0;
		while ( (matched = handlerQueue[ i++ ]) && !event.isPropagationStopped() ) {
			event.currentTarget = matched.elem;

			j = 0;
			while ( (handleObj = matched.handlers[ j++ ]) && !event.isImmediatePropagationStopped() ) {

				// Triggered event must either 1) have no namespace, or
				// 2) have namespace(s) a subset or equal to those in the bound event (both can have no namespace).
				if ( !event.namespace_re || event.namespace_re.test( handleObj.namespace ) ) {

					event.handleObj = handleObj;
					event.data = handleObj.data;

					ret = ( (jQuery.event.special[ handleObj.origType ] || {}).handle || handleObj.handler )
							.apply( matched.elem, args );

					if ( ret !== undefined ) {
						if ( (event.result = ret) === false ) {
							event.preventDefault();
							event.stopPropagation();
						}
					}
				}
			}
		}

		// Call the postDispatch hook for the mapped type
		if ( special.postDispatch ) {
			special.postDispatch.call( this, event );
		}

		return event.result;
	},

	handlers: function( event, handlers ) {
		var i, matches, sel, handleObj,
			handlerQueue = [],
			delegateCount = handlers.delegateCount,
			cur = event.target;

		// Find delegate handlers
		// Black-hole SVG <use> instance trees (#13180)
		// Avoid non-left-click bubbling in Firefox (#3861)
		if ( delegateCount && cur.nodeType && (!event.button || event.type !== "click") ) {

			for ( ; cur != this; cur = cur.parentNode || this ) {

				// Don't process clicks on disabled elements (#6911, #8165, #11382, #11764)
				if ( cur.disabled !== true || event.type !== "click" ) {
					matches = [];
					for ( i = 0; i < delegateCount; i++ ) {
						handleObj = handlers[ i ];

						// Don't conflict with Object.prototype properties (#13203)
						sel = handleObj.selector + " ";

						if ( matches[ sel ] === undefined ) {
							matches[ sel ] = handleObj.needsContext ?
								jQuery( sel, this ).index( cur ) >= 0 :
								jQuery.find( sel, this, null, [ cur ] ).length;
						}
						if ( matches[ sel ] ) {
							matches.push( handleObj );
						}
					}
					if ( matches.length ) {
						handlerQueue.push({ elem: cur, handlers: matches });
					}
				}
			}
		}

		// Add the remaining (directly-bound) handlers
		if ( delegateCount < handlers.length ) {
			handlerQueue.push({ elem: this, handlers: handlers.slice( delegateCount ) });
		}

		return handlerQueue;
	},

	fix: function( event ) {
		if ( event[ jQuery.expando ] ) {
			return event;
		}

		// Create a writable copy of the event object and normalize some properties
		var i, prop,
			originalEvent = event,
			fixHook = jQuery.event.fixHooks[ event.type ] || {},
			copy = fixHook.props ? this.props.concat( fixHook.props ) : this.props;

		event = new jQuery.Event( originalEvent );

		i = copy.length;
		while ( i-- ) {
			prop = copy[ i ];
			event[ prop ] = originalEvent[ prop ];
		}

		// Support: IE<9
		// Fix target property (#1925)
		if ( !event.target ) {
			event.target = originalEvent.srcElement || document;
		}

		// Support: Chrome 23+, Safari?
		// Target should not be a text node (#504, #13143)
		if ( event.target.nodeType === 3 ) {
			event.target = event.target.parentNode;
		}

		// Support: IE<9
		// For mouse/key events, metaKey==false if it's undefined (#3368, #11328)
		event.metaKey = !!event.metaKey;

		return fixHook.filter ? fixHook.filter( event, originalEvent ) : event;
	},

	// Includes some event props shared by KeyEvent and MouseEvent
	props: "altKey bubbles cancelable ctrlKey currentTarget eventPhase metaKey relatedTarget shiftKey target timeStamp view which".split(" "),

	fixHooks: {},

	keyHooks: {
		props: "char charCode key keyCode".split(" "),
		filter: function( event, original ) {

			// Add which for key events
			if ( event.which == null ) {
				event.which = original.charCode != null ? original.charCode : original.keyCode;
			}

			return event;
		}
	},

	mouseHooks: {
		props: "button buttons clientX clientY fromElement offsetX offsetY pageX pageY screenX screenY toElement".split(" "),
		filter: function( event, original ) {
			var eventDoc, doc, body,
				button = original.button,
				fromElement = original.fromElement;

			// Calculate pageX/Y if missing and clientX/Y available
			if ( event.pageX == null && original.clientX != null ) {
				eventDoc = event.target.ownerDocument || document;
				doc = eventDoc.documentElement;
				body = eventDoc.body;

				event.pageX = original.clientX + ( doc && doc.scrollLeft || body && body.scrollLeft || 0 ) - ( doc && doc.clientLeft || body && body.clientLeft || 0 );
				event.pageY = original.clientY + ( doc && doc.scrollTop  || body && body.scrollTop  || 0 ) - ( doc && doc.clientTop  || body && body.clientTop  || 0 );
			}

			// Add relatedTarget, if necessary
			if ( !event.relatedTarget && fromElement ) {
				event.relatedTarget = fromElement === event.target ? original.toElement : fromElement;
			}

			// Add which for click: 1 === left; 2 === middle; 3 === right
			// Note: button is not normalized, so don't use it
			if ( !event.which && button !== undefined ) {
				event.which = ( button & 1 ? 1 : ( button & 2 ? 3 : ( button & 4 ? 2 : 0 ) ) );
			}

			return event;
		}
	},

	special: {
		load: {
			// Prevent triggered image.load events from bubbling to window.load
			noBubble: true
		},
		click: {
			// For checkbox, fire native event so checked state will be right
			trigger: function() {
				if ( jQuery.nodeName( this, "input" ) && this.type === "checkbox" && this.click ) {
					this.click();
					return false;
				}
			}
		},
		focus: {
			// Fire native event if possible so blur/focus sequence is correct
			trigger: function() {
				if ( this !== document.activeElement && this.focus ) {
					try {
						this.focus();
						return false;
					} catch ( e ) {
						// Support: IE<9
						// If we error on focus to hidden element (#1486, #12518),
						// let .trigger() run the handlers
					}
				}
			},
			delegateType: "focusin"
		},
		blur: {
			trigger: function() {
				if ( this === document.activeElement && this.blur ) {
					this.blur();
					return false;
				}
			},
			delegateType: "focusout"
		},

		beforeunload: {
			postDispatch: function( event ) {

				// Even when returnValue equals to undefined Firefox will still show alert
				if ( event.result !== undefined ) {
					event.originalEvent.returnValue = event.result;
				}
			}
		}
	},

	simulate: function( type, elem, event, bubble ) {
		// Piggyback on a donor event to simulate a different one.
		// Fake originalEvent to avoid donor's stopPropagation, but if the
		// simulated event prevents default then we do the same on the donor.
		var e = jQuery.extend(
			new jQuery.Event(),
			event,
			{ type: type,
				isSimulated: true,
				originalEvent: {}
			}
		);
		if ( bubble ) {
			jQuery.event.trigger( e, null, elem );
		} else {
			jQuery.event.dispatch.call( elem, e );
		}
		if ( e.isDefaultPrevented() ) {
			event.preventDefault();
		}
	}
};

jQuery.removeEvent = document.removeEventListener ?
	function( elem, type, handle ) {
		if ( elem.removeEventListener ) {
			elem.removeEventListener( type, handle, false );
		}
	} :
	function( elem, type, handle ) {
		var name = "on" + type;

		if ( elem.detachEvent ) {

			// #8545, #7054, preventing memory leaks for custom events in IE6-8
			// detachEvent needed property on element, by name of that event, to properly expose it to GC
			if ( typeof elem[ name ] === "undefined" ) {
				elem[ name ] = null;
			}

			elem.detachEvent( name, handle );
		}
	};

jQuery.Event = function( src, props ) {
	// Allow instantiation without the 'new' keyword
	if ( !(this instanceof jQuery.Event) ) {
		return new jQuery.Event( src, props );
	}

	// Event object
	if ( src && src.type ) {
		this.originalEvent = src;
		this.type = src.type;

		// Events bubbling up the document may have been marked as prevented
		// by a handler lower down the tree; reflect the correct value.
		this.isDefaultPrevented = ( src.defaultPrevented || src.returnValue === false ||
			src.getPreventDefault && src.getPreventDefault() ) ? returnTrue : returnFalse;

	// Event type
	} else {
		this.type = src;
	}

	// Put explicitly provided properties onto the event object
	if ( props ) {
		jQuery.extend( this, props );
	}

	// Create a timestamp if incoming event doesn't have one
	this.timeStamp = src && src.timeStamp || jQuery.now();

	// Mark it as fixed
	this[ jQuery.expando ] = true;
};

// jQuery.Event is based on DOM3 Events as specified by the ECMAScript Language Binding
// http://www.w3.org/TR/2003/WD-DOM-Level-3-Events-20030331/ecma-script-binding.html
jQuery.Event.prototype = {
	isDefaultPrevented: returnFalse,
	isPropagationStopped: returnFalse,
	isImmediatePropagationStopped: returnFalse,

	preventDefault: function() {
		var e = this.originalEvent;

		this.isDefaultPrevented = returnTrue;
		if ( !e ) {
			return;
		}

		// If preventDefault exists, run it on the original event
		if ( e.preventDefault ) {
			e.preventDefault();

		// Support: IE
		// Otherwise set the returnValue property of the original event to false
		} else {
			e.returnValue = false;
		}
	},
	stopPropagation: function() {
		var e = this.originalEvent;

		this.isPropagationStopped = returnTrue;
		if ( !e ) {
			return;
		}
		// If stopPropagation exists, run it on the original event
		if ( e.stopPropagation ) {
			e.stopPropagation();
		}

		// Support: IE
		// Set the cancelBubble property of the original event to true
		e.cancelBubble = true;
	},
	stopImmediatePropagation: function() {
		this.isImmediatePropagationStopped = returnTrue;
		this.stopPropagation();
	}
};

// Create mouseenter/leave events using mouseover/out and event-time checks
jQuery.each({
	mouseenter: "mouseover",
	mouseleave: "mouseout"
}, function( orig, fix ) {
	jQuery.event.special[ orig ] = {
		delegateType: fix,
		bindType: fix,

		handle: function( event ) {
			var ret,
				target = this,
				related = event.relatedTarget,
				handleObj = event.handleObj;

			// For mousenter/leave call the handler if related is outside the target.
			// NB: No relatedTarget if the mouse left/entered the browser window
			if ( !related || (related !== target && !jQuery.contains( target, related )) ) {
				event.type = handleObj.origType;
				ret = handleObj.handler.apply( this, arguments );
				event.type = fix;
			}
			return ret;
		}
	};
});

// IE submit delegation
if ( !jQuery.support.submitBubbles ) {

	jQuery.event.special.submit = {
		setup: function() {
			// Only need this for delegated form submit events
			if ( jQuery.nodeName( this, "form" ) ) {
				return false;
			}

			// Lazy-add a submit handler when a descendant form may potentially be submitted
			jQuery.event.add( this, "click._submit keypress._submit", function( e ) {
				// Node name check avoids a VML-related crash in IE (#9807)
				var elem = e.target,
					form = jQuery.nodeName( elem, "input" ) || jQuery.nodeName( elem, "button" ) ? elem.form : undefined;
				if ( form && !jQuery._data( form, "submitBubbles" ) ) {
					jQuery.event.add( form, "submit._submit", function( event ) {
						event._submit_bubble = true;
					});
					jQuery._data( form, "submitBubbles", true );
				}
			});
			// return undefined since we don't need an event listener
		},

		postDispatch: function( event ) {
			// If form was submitted by the user, bubble the event up the tree
			if ( event._submit_bubble ) {
				delete event._submit_bubble;
				if ( this.parentNode && !event.isTrigger ) {
					jQuery.event.simulate( "submit", this.parentNode, event, true );
				}
			}
		},

		teardown: function() {
			// Only need this for delegated form submit events
			if ( jQuery.nodeName( this, "form" ) ) {
				return false;
			}

			// Remove delegated handlers; cleanData eventually reaps submit handlers attached above
			jQuery.event.remove( this, "._submit" );
		}
	};
}

// IE change delegation and checkbox/radio fix
if ( !jQuery.support.changeBubbles ) {

	jQuery.event.special.change = {

		setup: function() {

			if ( rformElems.test( this.nodeName ) ) {
				// IE doesn't fire change on a check/radio until blur; trigger it on click
				// after a propertychange. Eat the blur-change in special.change.handle.
				// This still fires onchange a second time for check/radio after blur.
				if ( this.type === "checkbox" || this.type === "radio" ) {
					jQuery.event.add( this, "propertychange._change", function( event ) {
						if ( event.originalEvent.propertyName === "checked" ) {
							this._just_changed = true;
						}
					});
					jQuery.event.add( this, "click._change", function( event ) {
						if ( this._just_changed && !event.isTrigger ) {
							this._just_changed = false;
						}
						// Allow triggered, simulated change events (#11500)
						jQuery.event.simulate( "change", this, event, true );
					});
				}
				return false;
			}
			// Delegated event; lazy-add a change handler on descendant inputs
			jQuery.event.add( this, "beforeactivate._change", function( e ) {
				var elem = e.target;

				if ( rformElems.test( elem.nodeName ) && !jQuery._data( elem, "changeBubbles" ) ) {
					jQuery.event.add( elem, "change._change", function( event ) {
						if ( this.parentNode && !event.isSimulated && !event.isTrigger ) {
							jQuery.event.simulate( "change", this.parentNode, event, true );
						}
					});
					jQuery._data( elem, "changeBubbles", true );
				}
			});
		},

		handle: function( event ) {
			var elem = event.target;

			// Swallow native change events from checkbox/radio, we already triggered them above
			if ( this !== elem || event.isSimulated || event.isTrigger || (elem.type !== "radio" && elem.type !== "checkbox") ) {
				return event.handleObj.handler.apply( this, arguments );
			}
		},

		teardown: function() {
			jQuery.event.remove( this, "._change" );

			return !rformElems.test( this.nodeName );
		}
	};
}

// Create "bubbling" focus and blur events
if ( !jQuery.support.focusinBubbles ) {
	jQuery.each({ focus: "focusin", blur: "focusout" }, function( orig, fix ) {

		// Attach a single capturing handler while someone wants focusin/focusout
		var attaches = 0,
			handler = function( event ) {
				jQuery.event.simulate( fix, event.target, jQuery.event.fix( event ), true );
			};

		jQuery.event.special[ fix ] = {
			setup: function() {
				if ( attaches++ === 0 ) {
					document.addEventListener( orig, handler, true );
				}
			},
			teardown: function() {
				if ( --attaches === 0 ) {
					document.removeEventListener( orig, handler, true );
				}
			}
		};
	});
}

jQuery.fn.extend({

	on: function( types, selector, data, fn, /*INTERNAL*/ one ) {
		var origFn, type;

		// Types can be a map of types/handlers
		if ( typeof types === "object" ) {
			// ( types-Object, selector, data )
			if ( typeof selector !== "string" ) {
				// ( types-Object, data )
				data = data || selector;
				selector = undefined;
			}
			for ( type in types ) {
				this.on( type, selector, data, types[ type ], one );
			}
			return this;
		}

		if ( data == null && fn == null ) {
			// ( types, fn )
			fn = selector;
			data = selector = undefined;
		} else if ( fn == null ) {
			if ( typeof selector === "string" ) {
				// ( types, selector, fn )
				fn = data;
				data = undefined;
			} else {
				// ( types, data, fn )
				fn = data;
				data = selector;
				selector = undefined;
			}
		}
		if ( fn === false ) {
			fn = returnFalse;
		} else if ( !fn ) {
			return this;
		}

		if ( one === 1 ) {
			origFn = fn;
			fn = function( event ) {
				// Can use an empty set, since event contains the info
				jQuery().off( event );
				return origFn.apply( this, arguments );
			};
			// Use same guid so caller can remove using origFn
			fn.guid = origFn.guid || ( origFn.guid = jQuery.guid++ );
		}
		return this.each( function() {
			jQuery.event.add( this, types, fn, data, selector );
		});
	},
	one: function( types, selector, data, fn ) {
		return this.on( types, selector, data, fn, 1 );
	},
	off: function( types, selector, fn ) {
		var handleObj, type;
		if ( types && types.preventDefault && types.handleObj ) {
			// ( event )  dispatched jQuery.Event
			handleObj = types.handleObj;
			jQuery( types.delegateTarget ).off(
				handleObj.namespace ? handleObj.origType + "." + handleObj.namespace : handleObj.origType,
				handleObj.selector,
				handleObj.handler
			);
			return this;
		}
		if ( typeof types === "object" ) {
			// ( types-object [, selector] )
			for ( type in types ) {
				this.off( type, selector, types[ type ] );
			}
			return this;
		}
		if ( selector === false || typeof selector === "function" ) {
			// ( types [, fn] )
			fn = selector;
			selector = undefined;
		}
		if ( fn === false ) {
			fn = returnFalse;
		}
		return this.each(function() {
			jQuery.event.remove( this, types, fn, selector );
		});
	},

	bind: function( types, data, fn ) {
		return this.on( types, null, data, fn );
	},
	unbind: function( types, fn ) {
		return this.off( types, null, fn );
	},

	delegate: function( selector, types, data, fn ) {
		return this.on( types, selector, data, fn );
	},
	undelegate: function( selector, types, fn ) {
		// ( namespace ) or ( selector, types [, fn] )
		return arguments.length === 1 ? this.off( selector, "**" ) : this.off( types, selector || "**", fn );
	},

	trigger: function( type, data ) {
		return this.each(function() {
			jQuery.event.trigger( type, data, this );
		});
	},
	triggerHandler: function( type, data ) {
		var elem = this[0];
		if ( elem ) {
			return jQuery.event.trigger( type, data, elem, true );
		}
	},

	hover: function( fnOver, fnOut ) {
		return this.mouseenter( fnOver ).mouseleave( fnOut || fnOver );
	}
});

jQuery.each( ("blur focus focusin focusout load resize scroll unload click dblclick " +
	"mousedown mouseup mousemove mouseover mouseout mouseenter mouseleave " +
	"change select submit keydown keypress keyup error contextmenu").split(" "), function( i, name ) {

	// Handle event binding
	jQuery.fn[ name ] = function( data, fn ) {
		return arguments.length > 0 ?
			this.on( name, null, data, fn ) :
			this.trigger( name );
	};

	if ( rkeyEvent.test( name ) ) {
		jQuery.event.fixHooks[ name ] = jQuery.event.keyHooks;
	}

	if ( rmouseEvent.test( name ) ) {
		jQuery.event.fixHooks[ name ] = jQuery.event.mouseHooks;
	}
});
/*!
 * Sizzle CSS Selector Engine
 * Copyright 2012 jQuery Foundation and other contributors
 * Released under the MIT license
 * http://sizzlejs.com/
 */
(function( window, undefined ) {

var i,
	cachedruns,
	Expr,
	getText,
	isXML,
	compile,
	hasDuplicate,
	outermostContext,

	// Local document vars
	setDocument,
	document,
	docElem,
	documentIsXML,
	rbuggyQSA,
	rbuggyMatches,
	matches,
	contains,
	sortOrder,

	// Instance-specific data
	expando = "sizzle" + -(new Date()),
	preferredDoc = window.document,
	support = {},
	dirruns = 0,
	done = 0,
	classCache = createCache(),
	tokenCache = createCache(),
	compilerCache = createCache(),

	// General-purpose constants
	strundefined = typeof undefined,
	MAX_NEGATIVE = 1 << 31,

	// Array methods
	arr = [],
	pop = arr.pop,
	push = arr.push,
	slice = arr.slice,
	// Use a stripped-down indexOf if we can't use a native one
	indexOf = arr.indexOf || function( elem ) {
		var i = 0,
			len = this.length;
		for ( ; i < len; i++ ) {
			if ( this[i] === elem ) {
				return i;
			}
		}
		return -1;
	},


	// Regular expressions

	// Whitespace characters http://www.w3.org/TR/css3-selectors/#whitespace
	whitespace = "[\\x20\\t\\r\\n\\f]",
	// http://www.w3.org/TR/css3-syntax/#characters
	characterEncoding = "(?:\\\\.|[\\w-]|[^\\x00-\\xa0])+",

	// Loosely modeled on CSS identifier characters
	// An unquoted value should be a CSS identifier http://www.w3.org/TR/css3-selectors/#attribute-selectors
	// Proper syntax: http://www.w3.org/TR/CSS21/syndata.html#value-def-identifier
	identifier = characterEncoding.replace( "w", "w#" ),

	// Acceptable operators http://www.w3.org/TR/selectors/#attribute-selectors
	operators = "([*^$|!~]?=)",
	attributes = "\\[" + whitespace + "*(" + characterEncoding + ")" + whitespace +
		"*(?:" + operators + whitespace + "*(?:(['\"])((?:\\\\.|[^\\\\])*?)\\3|(" + identifier + ")|)|)" + whitespace + "*\\]",

	// Prefer arguments quoted,
	//   then not containing pseudos/brackets,
	//   then attribute selectors/non-parenthetical expressions,
	//   then anything else
	// These preferences are here to reduce the number of selectors
	//   needing tokenize in the PSEUDO preFilter
	pseudos = ":(" + characterEncoding + ")(?:\\(((['\"])((?:\\\\.|[^\\\\])*?)\\3|((?:\\\\.|[^\\\\()[\\]]|" + attributes.replace( 3, 8 ) + ")*)|.*)\\)|)",

	// Leading and non-escaped trailing whitespace, capturing some non-whitespace characters preceding the latter
	rtrim = new RegExp( "^" + whitespace + "+|((?:^|[^\\\\])(?:\\\\.)*)" + whitespace + "+$", "g" ),

	rcomma = new RegExp( "^" + whitespace + "*," + whitespace + "*" ),
	rcombinators = new RegExp( "^" + whitespace + "*([\\x20\\t\\r\\n\\f>+~])" + whitespace + "*" ),
	rpseudo = new RegExp( pseudos ),
	ridentifier = new RegExp( "^" + identifier + "$" ),

	matchExpr = {
		"ID": new RegExp( "^#(" + characterEncoding + ")" ),
		"CLASS": new RegExp( "^\\.(" + characterEncoding + ")" ),
		"NAME": new RegExp( "^\\[name=['\"]?(" + characterEncoding + ")['\"]?\\]" ),
		"TAG": new RegExp( "^(" + characterEncoding.replace( "w", "w*" ) + ")" ),
		"ATTR": new RegExp( "^" + attributes ),
		"PSEUDO": new RegExp( "^" + pseudos ),
		"CHILD": new RegExp( "^:(only|first|last|nth|nth-last)-(child|of-type)(?:\\(" + whitespace +
			"*(even|odd|(([+-]|)(\\d*)n|)" + whitespace + "*(?:([+-]|)" + whitespace +
			"*(\\d+)|))" + whitespace + "*\\)|)", "i" ),
		// For use in libraries implementing .is()
		// We use this for POS matching in `select`
		"needsContext": new RegExp( "^" + whitespace + "*[>+~]|:(even|odd|eq|gt|lt|nth|first|last)(?:\\(" +
			whitespace + "*((?:-\\d)?\\d*)" + whitespace + "*\\)|)(?=[^-]|$)", "i" )
	},

	rsibling = /[\x20\t\r\n\f]*[+~]/,

	rnative = /\{\s*\[native code\]\s*\}/,

	// Easily-parseable/retrievable ID or TAG or CLASS selectors
	rquickExpr = /^(?:#([\w-]+)|(\w+)|\.([\w-]+))$/,

	rinputs = /^(?:input|select|textarea|button)$/i,
	rheader = /^h\d$/i,

	rescape = /'|\\/g,
	rattributeQuotes = /\=[\x20\t\r\n\f]*([^'"\]]*)[\x20\t\r\n\f]*\]/g,

	// CSS escapes http://www.w3.org/TR/CSS21/syndata.html#escaped-characters
	runescape = /\\([\da-fA-F]{1,6}[\x20\t\r\n\f]?|.)/g,
	funescape = function( _, escaped ) {
		var high = "0x" + escaped - 0x10000;
		// NaN means non-codepoint
		return high !== high ?
			escaped :
			// BMP codepoint
			high < 0 ?
				String.fromCharCode( high + 0x10000 ) :
				// Supplemental Plane codepoint (surrogate pair)
				String.fromCharCode( high >> 10 | 0xD800, high & 0x3FF | 0xDC00 );
	};

// Use a stripped-down slice if we can't use a native one
try {
	slice.call( docElem.childNodes, 0 )[0].nodeType;
} catch ( e ) {
	slice = function( i ) {
		var elem,
			results = [];
		for ( ; (elem = this[i]); i++ ) {
			results.push( elem );
		}
		return results;
	};
}

/**
 * For feature detection
 * @param {Function} fn The function to test for native support
 */
function isNative( fn ) {
	return rnative.test( fn + "" );
}

/**
 * Create key-value caches of limited size
 * @returns {Function(string, Object)} Returns the Object data after storing it on itself with
 *	property name the (space-suffixed) string and (if the cache is larger than Expr.cacheLength)
 *	deleting the oldest entry
 */
function createCache() {
	var cache,
		keys = [];

	return (cache = function( key, value ) {
		// Use (key + " ") to avoid collision with native prototype properties (see Issue #157)
		if ( keys.push( key += " " ) > Expr.cacheLength ) {
			// Only keep the most recent entries
			delete cache[ keys.shift() ];
		}
		return (cache[ key ] = value);
	});
}

/**
 * Mark a function for special use by Sizzle
 * @param {Function} fn The function to mark
 */
function markFunction( fn ) {
	fn[ expando ] = true;
	return fn;
}

/**
 * Support testing using an element
 * @param {Function} fn Passed the created div and expects a boolean result
 */
function assert( fn ) {
	var div = document.createElement("div");

	try {
		return fn( div );
	} catch (e) {
		return false;
	} finally {
		// release memory in IE
		div = null;
	}
}

function Sizzle( selector, context, results, seed ) {
	var match, elem, m, nodeType,
		// QSA vars
		i, groups, old, nid, newContext, newSelector;

	if ( ( context ? context.ownerDocument || context : preferredDoc ) !== document ) {
		setDocument( context );
	}

	context = context || document;
	results = results || [];

	if ( !selector || typeof selector !== "string" ) {
		return results;
	}

	if ( (nodeType = context.nodeType) !== 1 && nodeType !== 9 ) {
		return [];
	}

	if ( !documentIsXML && !seed ) {

		// Shortcuts
		if ( (match = rquickExpr.exec( selector )) ) {
			// Speed-up: Sizzle("#ID")
			if ( (m = match[1]) ) {
				if ( nodeType === 9 ) {
					elem = context.getElementById( m );
					// Check parentNode to catch when Blackberry 4.6 returns
					// nodes that are no longer in the document #6963
					if ( elem && elem.parentNode ) {
						// Handle the case where IE, Opera, and Webkit return items
						// by name instead of ID
						if ( elem.id === m ) {
							results.push( elem );
							return results;
						}
					} else {
						return results;
					}
				} else {
					// Context is not a document
					if ( context.ownerDocument && (elem = context.ownerDocument.getElementById( m )) &&
						contains( context, elem ) && elem.id === m ) {
						results.push( elem );
						return results;
					}
				}

			// Speed-up: Sizzle("TAG")
			} else if ( match[2] ) {
				push.apply( results, slice.call(context.getElementsByTagName( selector ), 0) );
				return results;

			// Speed-up: Sizzle(".CLASS")
			} else if ( (m = match[3]) && support.getByClassName && context.getElementsByClassName ) {
				push.apply( results, slice.call(context.getElementsByClassName( m ), 0) );
				return results;
			}
		}

		// QSA path
		if ( support.qsa && !rbuggyQSA.test(selector) ) {
			old = true;
			nid = expando;
			newContext = context;
			newSelector = nodeType === 9 && selector;

			// qSA works strangely on Element-rooted queries
			// We can work around this by specifying an extra ID on the root
			// and working up from there (Thanks to Andrew Dupont for the technique)
			// IE 8 doesn't work on object elements
			if ( nodeType === 1 && context.nodeName.toLowerCase() !== "object" ) {
				groups = tokenize( selector );

				if ( (old = context.getAttribute("id")) ) {
					nid = old.replace( rescape, "\\$&" );
				} else {
					context.setAttribute( "id", nid );
				}
				nid = "[id='" + nid + "'] ";

				i = groups.length;
				while ( i-- ) {
					groups[i] = nid + toSelector( groups[i] );
				}
				newContext = rsibling.test( selector ) && context.parentNode || context;
				newSelector = groups.join(",");
			}

			if ( newSelector ) {
				try {
					push.apply( results, slice.call( newContext.querySelectorAll(
						newSelector
					), 0 ) );
					return results;
				} catch(qsaError) {
				} finally {
					if ( !old ) {
						context.removeAttribute("id");
					}
				}
			}
		}
	}

	// All others
	return select( selector.replace( rtrim, "$1" ), context, results, seed );
}

/**
 * Detect xml
 * @param {Element|Object} elem An element or a document
 */
isXML = Sizzle.isXML = function( elem ) {
	// documentElement is verified for cases where it doesn't yet exist
	// (such as loading iframes in IE - #4833)
	var documentElement = elem && (elem.ownerDocument || elem).documentElement;
	return documentElement ? documentElement.nodeName !== "HTML" : false;
};

/**
 * Sets document-related variables once based on the current document
 * @param {Element|Object} [doc] An element or document object to use to set the document
 * @returns {Object} Returns the current document
 */
setDocument = Sizzle.setDocument = function( node ) {
	var doc = node ? node.ownerDocument || node : preferredDoc;

	// If no document and documentElement is available, return
	if ( doc === document || doc.nodeType !== 9 || !doc.documentElement ) {
		return document;
	}

	// Set our document
	document = doc;
	docElem = doc.documentElement;

	// Support tests
	documentIsXML = isXML( doc );

	// Check if getElementsByTagName("*") returns only elements
	support.tagNameNoComments = assert(function( div ) {
		div.appendChild( doc.createComment("") );
		return !div.getElementsByTagName("*").length;
	});

	// Check if attributes should be retrieved by attribute nodes
	support.attributes = assert(function( div ) {
		div.innerHTML = "<select></select>";
		var type = typeof div.lastChild.getAttribute("multiple");
		// IE8 returns a string for some attributes even when not present
		return type !== "boolean" && type !== "string";
	});

	// Check if getElementsByClassName can be trusted
	support.getByClassName = assert(function( div ) {
		// Opera can't find a second classname (in 9.6)
		div.innerHTML = "<div class='hidden e'></div><div class='hidden'></div>";
		if ( !div.getElementsByClassName || !div.getElementsByClassName("e").length ) {
			return false;
		}

		// Safari 3.2 caches class attributes and doesn't catch changes
		div.lastChild.className = "e";
		return div.getElementsByClassName("e").length === 2;
	});

	// Check if getElementById returns elements by name
	// Check if getElementsByName privileges form controls or returns elements by ID
	support.getByName = assert(function( div ) {
		// Inject content
		div.id = expando + 0;
		div.innerHTML = "<a name='" + expando + "'></a><div name='" + expando + "'></div>";
		docElem.insertBefore( div, docElem.firstChild );

		// Test
		var pass = doc.getElementsByName &&
			// buggy browsers will return fewer than the correct 2
			doc.getElementsByName( expando ).length === 2 +
			// buggy browsers will return more than the correct 0
			doc.getElementsByName( expando + 0 ).length;
		support.getIdNotName = !doc.getElementById( expando );

		// Cleanup
		docElem.removeChild( div );

		return pass;
	});

	// IE6/7 return modified attributes
	Expr.attrHandle = assert(function( div ) {
		div.innerHTML = "<a href='#'></a>";
		return div.firstChild && typeof div.firstChild.getAttribute !== strundefined &&
			div.firstChild.getAttribute("href") === "#";
	}) ?
		{} :
		{
			"href": function( elem ) {
				return elem.getAttribute( "href", 2 );
			},
			"type": function( elem ) {
				return elem.getAttribute("type");
			}
		};

	// ID find and filter
	if ( support.getIdNotName ) {
		Expr.find["ID"] = function( id, context ) {
			if ( typeof context.getElementById !== strundefined && !documentIsXML ) {
				var m = context.getElementById( id );
				// Check parentNode to catch when Blackberry 4.6 returns
				// nodes that are no longer in the document #6963
				return m && m.parentNode ? [m] : [];
			}
		};
		Expr.filter["ID"] = function( id ) {
			var attrId = id.replace( runescape, funescape );
			return function( elem ) {
				return elem.getAttribute("id") === attrId;
			};
		};
	} else {
		Expr.find["ID"] = function( id, context ) {
			if ( typeof context.getElementById !== strundefined && !documentIsXML ) {
				var m = context.getElementById( id );

				return m ?
					m.id === id || typeof m.getAttributeNode !== strundefined && m.getAttributeNode("id").value === id ?
						[m] :
						undefined :
					[];
			}
		};
		Expr.filter["ID"] =  function( id ) {
			var attrId = id.replace( runescape, funescape );
			return function( elem ) {
				var node = typeof elem.getAttributeNode !== strundefined && elem.getAttributeNode("id");
				return node && node.value === attrId;
			};
		};
	}

	// Tag
	Expr.find["TAG"] = support.tagNameNoComments ?
		function( tag, context ) {
			if ( typeof context.getElementsByTagName !== strundefined ) {
				return context.getElementsByTagName( tag );
			}
		} :
		function( tag, context ) {
			var elem,
				tmp = [],
				i = 0,
				results = context.getElementsByTagName( tag );

			// Filter out possible comments
			if ( tag === "*" ) {
				for ( ; (elem = results[i]); i++ ) {
					if ( elem.nodeType === 1 ) {
						tmp.push( elem );
					}
				}

				return tmp;
			}
			return results;
		};

	// Name
	Expr.find["NAME"] = support.getByName && function( tag, context ) {
		if ( typeof context.getElementsByName !== strundefined ) {
			return context.getElementsByName( name );
		}
	};

	// Class
	Expr.find["CLASS"] = support.getByClassName && function( className, context ) {
		if ( typeof context.getElementsByClassName !== strundefined && !documentIsXML ) {
			return context.getElementsByClassName( className );
		}
	};

	// QSA and matchesSelector support

	// matchesSelector(:active) reports false when true (IE9/Opera 11.5)
	rbuggyMatches = [];

	// qSa(:focus) reports false when true (Chrome 21),
	// no need to also add to buggyMatches since matches checks buggyQSA
	// A support test would require too much code (would include document ready)
	rbuggyQSA = [ ":focus" ];

	if ( (support.qsa = isNative(doc.querySelectorAll)) ) {
		// Build QSA regex
		// Regex strategy adopted from Diego Perini
		assert(function( div ) {
			// Select is set to empty string on purpose
			// This is to test IE's treatment of not explictly
			// setting a boolean content attribute,
			// since its presence should be enough
			// http://bugs.jquery.com/ticket/12359
			div.innerHTML = "<select><option selected=''></option></select>";

			// IE8 - Some boolean attributes are not treated correctly
			if ( !div.querySelectorAll("[selected]").length ) {
				rbuggyQSA.push( "\\[" + whitespace + "*(?:checked|disabled|ismap|multiple|readonly|selected|value)" );
			}

			// Webkit/Opera - :checked should return selected option elements
			// http://www.w3.org/TR/2011/REC-css3-selectors-20110929/#checked
			// IE8 throws error here and will not see later tests
			if ( !div.querySelectorAll(":checked").length ) {
				rbuggyQSA.push(":checked");
			}
		});

		assert(function( div ) {

			// Opera 10-12/IE8 - ^= $= *= and empty values
			// Should not select anything
			div.innerHTML = "<input type='hidden' i=''/>";
			if ( div.querySelectorAll("[i^='']").length ) {
				rbuggyQSA.push( "[*^$]=" + whitespace + "*(?:\"\"|'')" );
			}

			// FF 3.5 - :enabled/:disabled and hidden elements (hidden elements are still enabled)
			// IE8 throws error here and will not see later tests
			if ( !div.querySelectorAll(":enabled").length ) {
				rbuggyQSA.push( ":enabled", ":disabled" );
			}

			// Opera 10-11 does not throw on post-comma invalid pseudos
			div.querySelectorAll("*,:x");
			rbuggyQSA.push(",.*:");
		});
	}

	if ( (support.matchesSelector = isNative( (matches = docElem.matchesSelector ||
		docElem.mozMatchesSelector ||
		docElem.webkitMatchesSelector ||
		docElem.oMatchesSelector ||
		docElem.msMatchesSelector) )) ) {

		assert(function( div ) {
			// Check to see if it's possible to do matchesSelector
			// on a disconnected node (IE 9)
			support.disconnectedMatch = matches.call( div, "div" );

			// This should fail with an exception
			// Gecko does not error, returns false instead
			matches.call( div, "[s!='']:x" );
			rbuggyMatches.push( "!=", pseudos );
		});
	}

	rbuggyQSA = new RegExp( rbuggyQSA.join("|") );
	rbuggyMatches = new RegExp( rbuggyMatches.join("|") );

	// Element contains another
	// Purposefully does not implement inclusive descendent
	// As in, an element does not contain itself
	contains = isNative(docElem.contains) || docElem.compareDocumentPosition ?
		function( a, b ) {
			var adown = a.nodeType === 9 ? a.documentElement : a,
				bup = b && b.parentNode;
			return a === bup || !!( bup && bup.nodeType === 1 && (
				adown.contains ?
					adown.contains( bup ) :
					a.compareDocumentPosition && a.compareDocumentPosition( bup ) & 16
			));
		} :
		function( a, b ) {
			if ( b ) {
				while ( (b = b.parentNode) ) {
					if ( b === a ) {
						return true;
					}
				}
			}
			return false;
		};

	// Document order sorting
	sortOrder = docElem.compareDocumentPosition ?
	function( a, b ) {
		var compare;

		if ( a === b ) {
			hasDuplicate = true;
			return 0;
		}

		if ( (compare = b.compareDocumentPosition && a.compareDocumentPosition && a.compareDocumentPosition( b )) ) {
			if ( compare & 1 || a.parentNode && a.parentNode.nodeType === 11 ) {
				if ( a === doc || contains( preferredDoc, a ) ) {
					return -1;
				}
				if ( b === doc || contains( preferredDoc, b ) ) {
					return 1;
				}
				return 0;
			}
			return compare & 4 ? -1 : 1;
		}

		return a.compareDocumentPosition ? -1 : 1;
	} :
	function( a, b ) {
		var cur,
			i = 0,
			aup = a.parentNode,
			bup = b.parentNode,
			ap = [ a ],
			bp = [ b ];

		// The nodes are identical, we can exit early
		if ( a === b ) {
			hasDuplicate = true;
			return 0;

		// Fallback to using sourceIndex (in IE) if it's available on both nodes
		} else if ( a.sourceIndex && b.sourceIndex ) {
			return ( ~b.sourceIndex || MAX_NEGATIVE ) - ( contains( preferredDoc, a ) && ~a.sourceIndex || MAX_NEGATIVE );

		// Parentless nodes are either documents or disconnected
		} else if ( !aup || !bup ) {
			return a === doc ? -1 :
				b === doc ? 1 :
				aup ? -1 :
				bup ? 1 :
				0;

		// If the nodes are siblings, we can do a quick check
		} else if ( aup === bup ) {
			return siblingCheck( a, b );
		}

		// Otherwise we need full lists of their ancestors for comparison
		cur = a;
		while ( (cur = cur.parentNode) ) {
			ap.unshift( cur );
		}
		cur = b;
		while ( (cur = cur.parentNode) ) {
			bp.unshift( cur );
		}

		// Walk down the tree looking for a discrepancy
		while ( ap[i] === bp[i] ) {
			i++;
		}

		return i ?
			// Do a sibling check if the nodes have a common ancestor
			siblingCheck( ap[i], bp[i] ) :

			// Otherwise nodes in our document sort first
			ap[i] === preferredDoc ? -1 :
			bp[i] === preferredDoc ? 1 :
			0;
	};

	// Always assume the presence of duplicates if sort doesn't
	// pass them to our comparison function (as in Google Chrome).
	hasDuplicate = false;
	[0, 0].sort( sortOrder );
	support.detectDuplicates = hasDuplicate;

	return document;
};

Sizzle.matches = function( expr, elements ) {
	return Sizzle( expr, null, null, elements );
};

Sizzle.matchesSelector = function( elem, expr ) {
	// Set document vars if needed
	if ( ( elem.ownerDocument || elem ) !== document ) {
		setDocument( elem );
	}

	// Make sure that attribute selectors are quoted
	expr = expr.replace( rattributeQuotes, "='$1']" );

	// rbuggyQSA always contains :focus, so no need for an existence check
	if ( support.matchesSelector && !documentIsXML && (!rbuggyMatches || !rbuggyMatches.test(expr)) && !rbuggyQSA.test(expr) ) {
		try {
			var ret = matches.call( elem, expr );

			// IE 9's matchesSelector returns false on disconnected nodes
			if ( ret || support.disconnectedMatch ||
					// As well, disconnected nodes are said to be in a document
					// fragment in IE 9
					elem.document && elem.document.nodeType !== 11 ) {
				return ret;
			}
		} catch(e) {}
	}

	return Sizzle( expr, document, null, [elem] ).length > 0;
};

Sizzle.contains = function( context, elem ) {
	// Set document vars if needed
	if ( ( context.ownerDocument || context ) !== document ) {
		setDocument( context );
	}
	return contains( context, elem );
};

Sizzle.attr = function( elem, name ) {
	var val;

	// Set document vars if needed
	if ( ( elem.ownerDocument || elem ) !== document ) {
		setDocument( elem );
	}

	if ( !documentIsXML ) {
		name = name.toLowerCase();
	}
	if ( (val = Expr.attrHandle[ name ]) ) {
		return val( elem );
	}
	if ( documentIsXML || support.attributes ) {
		return elem.getAttribute( name );
	}
	return ( (val = elem.getAttributeNode( name )) || elem.getAttribute( name ) ) && elem[ name ] === true ?
		name :
		val && val.specified ? val.value : null;
};

Sizzle.error = function( msg ) {
	throw new Error( "Syntax error, unrecognized expression: " + msg );
};

// Document sorting and removing duplicates
Sizzle.uniqueSort = function( results ) {
	var elem,
		duplicates = [],
		i = 1,
		j = 0;

	// Unless we *know* we can detect duplicates, assume their presence
	hasDuplicate = !support.detectDuplicates;
	results.sort( sortOrder );

	if ( hasDuplicate ) {
		for ( ; (elem = results[i]); i++ ) {
			if ( elem === results[ i - 1 ] ) {
				j = duplicates.push( i );
			}
		}
		while ( j-- ) {
			results.splice( duplicates[ j ], 1 );
		}
	}

	return results;
};

function siblingCheck( a, b ) {
	var cur = a && b && a.nextSibling;

	for ( ; cur; cur = cur.nextSibling ) {
		if ( cur === b ) {
			return -1;
		}
	}

	return a ? 1 : -1;
}

// Returns a function to use in pseudos for input types
function createInputPseudo( type ) {
	return function( elem ) {
		var name = elem.nodeName.toLowerCase();
		return name === "input" && elem.type === type;
	};
}

// Returns a function to use in pseudos for buttons
function createButtonPseudo( type ) {
	return function( elem ) {
		var name = elem.nodeName.toLowerCase();
		return (name === "input" || name === "button") && elem.type === type;
	};
}

// Returns a function to use in pseudos for positionals
function createPositionalPseudo( fn ) {
	return markFunction(function( argument ) {
		argument = +argument;
		return markFunction(function( seed, matches ) {
			var j,
				matchIndexes = fn( [], seed.length, argument ),
				i = matchIndexes.length;

			// Match elements found at the specified indexes
			while ( i-- ) {
				if ( seed[ (j = matchIndexes[i]) ] ) {
					seed[j] = !(matches[j] = seed[j]);
				}
			}
		});
	});
}

/**
 * Utility function for retrieving the text value of an array of DOM nodes
 * @param {Array|Element} elem
 */
getText = Sizzle.getText = function( elem ) {
	var node,
		ret = "",
		i = 0,
		nodeType = elem.nodeType;

	if ( !nodeType ) {
		// If no nodeType, this is expected to be an array
		for ( ; (node = elem[i]); i++ ) {
			// Do not traverse comment nodes
			ret += getText( node );
		}
	} else if ( nodeType === 1 || nodeType === 9 || nodeType === 11 ) {
		// Use textContent for elements
		// innerText usage removed for consistency of new lines (see #11153)
		if ( typeof elem.textContent === "string" ) {
			return elem.textContent;
		} else {
			// Traverse its children
			for ( elem = elem.firstChild; elem; elem = elem.nextSibling ) {
				ret += getText( elem );
			}
		}
	} else if ( nodeType === 3 || nodeType === 4 ) {
		return elem.nodeValue;
	}
	// Do not include comment or processing instruction nodes

	return ret;
};

Expr = Sizzle.selectors = {

	// Can be adjusted by the user
	cacheLength: 50,

	createPseudo: markFunction,

	match: matchExpr,

	find: {},

	relative: {
		">": { dir: "parentNode", first: true },
		" ": { dir: "parentNode" },
		"+": { dir: "previousSibling", first: true },
		"~": { dir: "previousSibling" }
	},

	preFilter: {
		"ATTR": function( match ) {
			match[1] = match[1].replace( runescape, funescape );

			// Move the given value to match[3] whether quoted or unquoted
			match[3] = ( match[4] || match[5] || "" ).replace( runescape, funescape );

			if ( match[2] === "~=" ) {
				match[3] = " " + match[3] + " ";
			}

			return match.slice( 0, 4 );
		},

		"CHILD": function( match ) {
			/* matches from matchExpr["CHILD"]
				1 type (only|nth|...)
				2 what (child|of-type)
				3 argument (even|odd|\d*|\d*n([+-]\d+)?|...)
				4 xn-component of xn+y argument ([+-]?\d*n|)
				5 sign of xn-component
				6 x of xn-component
				7 sign of y-component
				8 y of y-component
			*/
			match[1] = match[1].toLowerCase();

			if ( match[1].slice( 0, 3 ) === "nth" ) {
				// nth-* requires argument
				if ( !match[3] ) {
					Sizzle.error( match[0] );
				}

				// numeric x and y parameters for Expr.filter.CHILD
				// remember that false/true cast respectively to 0/1
				match[4] = +( match[4] ? match[5] + (match[6] || 1) : 2 * ( match[3] === "even" || match[3] === "odd" ) );
				match[5] = +( ( match[7] + match[8] ) || match[3] === "odd" );

			// other types prohibit arguments
			} else if ( match[3] ) {
				Sizzle.error( match[0] );
			}

			return match;
		},

		"PSEUDO": function( match ) {
			var excess,
				unquoted = !match[5] && match[2];

			if ( matchExpr["CHILD"].test( match[0] ) ) {
				return null;
			}

			// Accept quoted arguments as-is
			if ( match[4] ) {
				match[2] = match[4];

			// Strip excess characters from unquoted arguments
			} else if ( unquoted && rpseudo.test( unquoted ) &&
				// Get excess from tokenize (recursively)
				(excess = tokenize( unquoted, true )) &&
				// advance to the next closing parenthesis
				(excess = unquoted.indexOf( ")", unquoted.length - excess ) - unquoted.length) ) {

				// excess is a negative index
				match[0] = match[0].slice( 0, excess );
				match[2] = unquoted.slice( 0, excess );
			}

			// Return only captures needed by the pseudo filter method (type and argument)
			return match.slice( 0, 3 );
		}
	},

	filter: {

		"TAG": function( nodeName ) {
			if ( nodeName === "*" ) {
				return function() { return true; };
			}

			nodeName = nodeName.replace( runescape, funescape ).toLowerCase();
			return function( elem ) {
				return elem.nodeName && elem.nodeName.toLowerCase() === nodeName;
			};
		},

		"CLASS": function( className ) {
			var pattern = classCache[ className + " " ];

			return pattern ||
				(pattern = new RegExp( "(^|" + whitespace + ")" + className + "(" + whitespace + "|$)" )) &&
				classCache( className, function( elem ) {
					return pattern.test( elem.className || (typeof elem.getAttribute !== strundefined && elem.getAttribute("class")) || "" );
				});
		},

		"ATTR": function( name, operator, check ) {
			return function( elem ) {
				var result = Sizzle.attr( elem, name );

				if ( result == null ) {
					return operator === "!=";
				}
				if ( !operator ) {
					return true;
				}

				result += "";

				return operator === "=" ? result === check :
					operator === "!=" ? result !== check :
					operator === "^=" ? check && result.indexOf( check ) === 0 :
					operator === "*=" ? check && result.indexOf( check ) > -1 :
					operator === "$=" ? check && result.substr( result.length - check.length ) === check :
					operator === "~=" ? ( " " + result + " " ).indexOf( check ) > -1 :
					operator === "|=" ? result === check || result.substr( 0, check.length + 1 ) === check + "-" :
					false;
			};
		},

		"CHILD": function( type, what, argument, first, last ) {
			var simple = type.slice( 0, 3 ) !== "nth",
				forward = type.slice( -4 ) !== "last",
				ofType = what === "of-type";

			return first === 1 && last === 0 ?

				// Shortcut for :nth-*(n)
				function( elem ) {
					return !!elem.parentNode;
				} :

				function( elem, context, xml ) {
					var cache, outerCache, node, diff, nodeIndex, start,
						dir = simple !== forward ? "nextSibling" : "previousSibling",
						parent = elem.parentNode,
						name = ofType && elem.nodeName.toLowerCase(),
						useCache = !xml && !ofType;

					if ( parent ) {

						// :(first|last|only)-(child|of-type)
						if ( simple ) {
							while ( dir ) {
								node = elem;
								while ( (node = node[ dir ]) ) {
									if ( ofType ? node.nodeName.toLowerCase() === name : node.nodeType === 1 ) {
										return false;
									}
								}
								// Reverse direction for :only-* (if we haven't yet done so)
								start = dir = type === "only" && !start && "nextSibling";
							}
							return true;
						}

						start = [ forward ? parent.firstChild : parent.lastChild ];

						// non-xml :nth-child(...) stores cache data on `parent`
						if ( forward && useCache ) {
							// Seek `elem` from a previously-cached index
							outerCache = parent[ expando ] || (parent[ expando ] = {});
							cache = outerCache[ type ] || [];
							nodeIndex = cache[0] === dirruns && cache[1];
							diff = cache[0] === dirruns && cache[2];
							node = nodeIndex && parent.childNodes[ nodeIndex ];

							while ( (node = ++nodeIndex && node && node[ dir ] ||

								// Fallback to seeking `elem` from the start
								(diff = nodeIndex = 0) || start.pop()) ) {

								// When found, cache indexes on `parent` and break
								if ( node.nodeType === 1 && ++diff && node === elem ) {
									outerCache[ type ] = [ dirruns, nodeIndex, diff ];
									break;
								}
							}

						// Use previously-cached element index if available
						} else if ( useCache && (cache = (elem[ expando ] || (elem[ expando ] = {}))[ type ]) && cache[0] === dirruns ) {
							diff = cache[1];

						// xml :nth-child(...) or :nth-last-child(...) or :nth(-last)?-of-type(...)
						} else {
							// Use the same loop as above to seek `elem` from the start
							while ( (node = ++nodeIndex && node && node[ dir ] ||
								(diff = nodeIndex = 0) || start.pop()) ) {

								if ( ( ofType ? node.nodeName.toLowerCase() === name : node.nodeType === 1 ) && ++diff ) {
									// Cache the index of each encountered element
									if ( useCache ) {
										(node[ expando ] || (node[ expando ] = {}))[ type ] = [ dirruns, diff ];
									}

									if ( node === elem ) {
										break;
									}
								}
							}
						}

						// Incorporate the offset, then check against cycle size
						diff -= last;
						return diff === first || ( diff % first === 0 && diff / first >= 0 );
					}
				};
		},

		"PSEUDO": function( pseudo, argument ) {
			// pseudo-class names are case-insensitive
			// http://www.w3.org/TR/selectors/#pseudo-classes
			// Prioritize by case sensitivity in case custom pseudos are added with uppercase letters
			// Remember that setFilters inherits from pseudos
			var args,
				fn = Expr.pseudos[ pseudo ] || Expr.setFilters[ pseudo.toLowerCase() ] ||
					Sizzle.error( "unsupported pseudo: " + pseudo );

			// The user may use createPseudo to indicate that
			// arguments are needed to create the filter function
			// just as Sizzle does
			if ( fn[ expando ] ) {
				return fn( argument );
			}

			// But maintain support for old signatures
			if ( fn.length > 1 ) {
				args = [ pseudo, pseudo, "", argument ];
				return Expr.setFilters.hasOwnProperty( pseudo.toLowerCase() ) ?
					markFunction(function( seed, matches ) {
						var idx,
							matched = fn( seed, argument ),
							i = matched.length;
						while ( i-- ) {
							idx = indexOf.call( seed, matched[i] );
							seed[ idx ] = !( matches[ idx ] = matched[i] );
						}
					}) :
					function( elem ) {
						return fn( elem, 0, args );
					};
			}

			return fn;
		}
	},

	pseudos: {
		// Potentially complex pseudos
		"not": markFunction(function( selector ) {
			// Trim the selector passed to compile
			// to avoid treating leading and trailing
			// spaces as combinators
			var input = [],
				results = [],
				matcher = compile( selector.replace( rtrim, "$1" ) );

			return matcher[ expando ] ?
				markFunction(function( seed, matches, context, xml ) {
					var elem,
						unmatched = matcher( seed, null, xml, [] ),
						i = seed.length;

					// Match elements unmatched by `matcher`
					while ( i-- ) {
						if ( (elem = unmatched[i]) ) {
							seed[i] = !(matches[i] = elem);
						}
					}
				}) :
				function( elem, context, xml ) {
					input[0] = elem;
					matcher( input, null, xml, results );
					return !results.pop();
				};
		}),

		"has": markFunction(function( selector ) {
			return function( elem ) {
				return Sizzle( selector, elem ).length > 0;
			};
		}),

		"contains": markFunction(function( text ) {
			return function( elem ) {
				return ( elem.textContent || elem.innerText || getText( elem ) ).indexOf( text ) > -1;
			};
		}),

		// "Whether an element is represented by a :lang() selector
		// is based solely on the element's language value
		// being equal to the identifier C,
		// or beginning with the identifier C immediately followed by "-".
		// The matching of C against the element's language value is performed case-insensitively.
		// The identifier C does not have to be a valid language name."
		// http://www.w3.org/TR/selectors/#lang-pseudo
		"lang": markFunction( function( lang ) {
			// lang value must be a valid identifider
			if ( !ridentifier.test(lang || "") ) {
				Sizzle.error( "unsupported lang: " + lang );
			}
			lang = lang.replace( runescape, funescape ).toLowerCase();
			return function( elem ) {
				var elemLang;
				do {
					if ( (elemLang = documentIsXML ?
						elem.getAttribute("xml:lang") || elem.getAttribute("lang") :
						elem.lang) ) {

						elemLang = elemLang.toLowerCase();
						return elemLang === lang || elemLang.indexOf( lang + "-" ) === 0;
					}
				} while ( (elem = elem.parentNode) && elem.nodeType === 1 );
				return false;
			};
		}),

		// Miscellaneous
		"target": function( elem ) {
			var hash = window.location && window.location.hash;
			return hash && hash.slice( 1 ) === elem.id;
		},

		"root": function( elem ) {
			return elem === docElem;
		},

		"focus": function( elem ) {
			return elem === document.activeElement && (!document.hasFocus || document.hasFocus()) && !!(elem.type || elem.href || ~elem.tabIndex);
		},

		// Boolean properties
		"enabled": function( elem ) {
			return elem.disabled === false;
		},

		"disabled": function( elem ) {
			return elem.disabled === true;
		},

		"checked": function( elem ) {
			// In CSS3, :checked should return both checked and selected elements
			// http://www.w3.org/TR/2011/REC-css3-selectors-20110929/#checked
			var nodeName = elem.nodeName.toLowerCase();
			return (nodeName === "input" && !!elem.checked) || (nodeName === "option" && !!elem.selected);
		},

		"selected": function( elem ) {
			// Accessing this property makes selected-by-default
			// options in Safari work properly
			if ( elem.parentNode ) {
				elem.parentNode.selectedIndex;
			}

			return elem.selected === true;
		},

		// Contents
		"empty": function( elem ) {
			// http://www.w3.org/TR/selectors/#empty-pseudo
			// :empty is only affected by element nodes and content nodes(including text(3), cdata(4)),
			//   not comment, processing instructions, or others
			// Thanks to Diego Perini for the nodeName shortcut
			//   Greater than "@" means alpha characters (specifically not starting with "#" or "?")
			for ( elem = elem.firstChild; elem; elem = elem.nextSibling ) {
				if ( elem.nodeName > "@" || elem.nodeType === 3 || elem.nodeType === 4 ) {
					return false;
				}
			}
			return true;
		},

		"parent": function( elem ) {
			return !Expr.pseudos["empty"]( elem );
		},

		// Element/input types
		"header": function( elem ) {
			return rheader.test( elem.nodeName );
		},

		"input": function( elem ) {
			return rinputs.test( elem.nodeName );
		},

		"button": function( elem ) {
			var name = elem.nodeName.toLowerCase();
			return name === "input" && elem.type === "button" || name === "button";
		},

		"text": function( elem ) {
			var attr;
			// IE6 and 7 will map elem.type to 'text' for new HTML5 types (search, etc)
			// use getAttribute instead to test this case
			return elem.nodeName.toLowerCase() === "input" &&
				elem.type === "text" &&
				( (attr = elem.getAttribute("type")) == null || attr.toLowerCase() === elem.type );
		},

		// Position-in-collection
		"first": createPositionalPseudo(function() {
			return [ 0 ];
		}),

		"last": createPositionalPseudo(function( matchIndexes, length ) {
			return [ length - 1 ];
		}),

		"eq": createPositionalPseudo(function( matchIndexes, length, argument ) {
			return [ argument < 0 ? argument + length : argument ];
		}),

		"even": createPositionalPseudo(function( matchIndexes, length ) {
			var i = 0;
			for ( ; i < length; i += 2 ) {
				matchIndexes.push( i );
			}
			return matchIndexes;
		}),

		"odd": createPositionalPseudo(function( matchIndexes, length ) {
			var i = 1;
			for ( ; i < length; i += 2 ) {
				matchIndexes.push( i );
			}
			return matchIndexes;
		}),

		"lt": createPositionalPseudo(function( matchIndexes, length, argument ) {
			var i = argument < 0 ? argument + length : argument;
			for ( ; --i >= 0; ) {
				matchIndexes.push( i );
			}
			return matchIndexes;
		}),

		"gt": createPositionalPseudo(function( matchIndexes, length, argument ) {
			var i = argument < 0 ? argument + length : argument;
			for ( ; ++i < length; ) {
				matchIndexes.push( i );
			}
			return matchIndexes;
		})
	}
};

// Add button/input type pseudos
for ( i in { radio: true, checkbox: true, file: true, password: true, image: true } ) {
	Expr.pseudos[ i ] = createInputPseudo( i );
}
for ( i in { submit: true, reset: true } ) {
	Expr.pseudos[ i ] = createButtonPseudo( i );
}

function tokenize( selector, parseOnly ) {
	var matched, match, tokens, type,
		soFar, groups, preFilters,
		cached = tokenCache[ selector + " " ];

	if ( cached ) {
		return parseOnly ? 0 : cached.slice( 0 );
	}

	soFar = selector;
	groups = [];
	preFilters = Expr.preFilter;

	while ( soFar ) {

		// Comma and first run
		if ( !matched || (match = rcomma.exec( soFar )) ) {
			if ( match ) {
				// Don't consume trailing commas as valid
				soFar = soFar.slice( match[0].length ) || soFar;
			}
			groups.push( tokens = [] );
		}

		matched = false;

		// Combinators
		if ( (match = rcombinators.exec( soFar )) ) {
			matched = match.shift();
			tokens.push( {
				value: matched,
				// Cast descendant combinators to space
				type: match[0].replace( rtrim, " " )
			} );
			soFar = soFar.slice( matched.length );
		}

		// Filters
		for ( type in Expr.filter ) {
			if ( (match = matchExpr[ type ].exec( soFar )) && (!preFilters[ type ] ||
				(match = preFilters[ type ]( match ))) ) {
				matched = match.shift();
				tokens.push( {
					value: matched,
					type: type,
					matches: match
				} );
				soFar = soFar.slice( matched.length );
			}
		}

		if ( !matched ) {
			break;
		}
	}

	// Return the length of the invalid excess
	// if we're just parsing
	// Otherwise, throw an error or return tokens
	return parseOnly ?
		soFar.length :
		soFar ?
			Sizzle.error( selector ) :
			// Cache the tokens
			tokenCache( selector, groups ).slice( 0 );
}

function toSelector( tokens ) {
	var i = 0,
		len = tokens.length,
		selector = "";
	for ( ; i < len; i++ ) {
		selector += tokens[i].value;
	}
	return selector;
}

function addCombinator( matcher, combinator, base ) {
	var dir = combinator.dir,
		checkNonElements = base && combinator.dir === "parentNode",
		doneName = done++;

	return combinator.first ?
		// Check against closest ancestor/preceding element
		function( elem, context, xml ) {
			while ( (elem = elem[ dir ]) ) {
				if ( elem.nodeType === 1 || checkNonElements ) {
					return matcher( elem, context, xml );
				}
			}
		} :

		// Check against all ancestor/preceding elements
		function( elem, context, xml ) {
			var data, cache, outerCache,
				dirkey = dirruns + " " + doneName;

			// We can't set arbitrary data on XML nodes, so they don't benefit from dir caching
			if ( xml ) {
				while ( (elem = elem[ dir ]) ) {
					if ( elem.nodeType === 1 || checkNonElements ) {
						if ( matcher( elem, context, xml ) ) {
							return true;
						}
					}
				}
			} else {
				while ( (elem = elem[ dir ]) ) {
					if ( elem.nodeType === 1 || checkNonElements ) {
						outerCache = elem[ expando ] || (elem[ expando ] = {});
						if ( (cache = outerCache[ dir ]) && cache[0] === dirkey ) {
							if ( (data = cache[1]) === true || data === cachedruns ) {
								return data === true;
							}
						} else {
							cache = outerCache[ dir ] = [ dirkey ];
							cache[1] = matcher( elem, context, xml ) || cachedruns;
							if ( cache[1] === true ) {
								return true;
							}
						}
					}
				}
			}
		};
}

function elementMatcher( matchers ) {
	return matchers.length > 1 ?
		function( elem, context, xml ) {
			var i = matchers.length;
			while ( i-- ) {
				if ( !matchers[i]( elem, context, xml ) ) {
					return false;
				}
			}
			return true;
		} :
		matchers[0];
}

function condense( unmatched, map, filter, context, xml ) {
	var elem,
		newUnmatched = [],
		i = 0,
		len = unmatched.length,
		mapped = map != null;

	for ( ; i < len; i++ ) {
		if ( (elem = unmatched[i]) ) {
			if ( !filter || filter( elem, context, xml ) ) {
				newUnmatched.push( elem );
				if ( mapped ) {
					map.push( i );
				}
			}
		}
	}

	return newUnmatched;
}

function setMatcher( preFilter, selector, matcher, postFilter, postFinder, postSelector ) {
	if ( postFilter && !postFilter[ expando ] ) {
		postFilter = setMatcher( postFilter );
	}
	if ( postFinder && !postFinder[ expando ] ) {
		postFinder = setMatcher( postFinder, postSelector );
	}
	return markFunction(function( seed, results, context, xml ) {
		var temp, i, elem,
			preMap = [],
			postMap = [],
			preexisting = results.length,

			// Get initial elements from seed or context
			elems = seed || multipleContexts( selector || "*", context.nodeType ? [ context ] : context, [] ),

			// Prefilter to get matcher input, preserving a map for seed-results synchronization
			matcherIn = preFilter && ( seed || !selector ) ?
				condense( elems, preMap, preFilter, context, xml ) :
				elems,

			matcherOut = matcher ?
				// If we have a postFinder, or filtered seed, or non-seed postFilter or preexisting results,
				postFinder || ( seed ? preFilter : preexisting || postFilter ) ?

					// ...intermediate processing is necessary
					[] :

					// ...otherwise use results directly
					results :
				matcherIn;

		// Find primary matches
		if ( matcher ) {
			matcher( matcherIn, matcherOut, context, xml );
		}

		// Apply postFilter
		if ( postFilter ) {
			temp = condense( matcherOut, postMap );
			postFilter( temp, [], context, xml );

			// Un-match failing elements by moving them back to matcherIn
			i = temp.length;
			while ( i-- ) {
				if ( (elem = temp[i]) ) {
					matcherOut[ postMap[i] ] = !(matcherIn[ postMap[i] ] = elem);
				}
			}
		}

		if ( seed ) {
			if ( postFinder || preFilter ) {
				if ( postFinder ) {
					// Get the final matcherOut by condensing this intermediate into postFinder contexts
					temp = [];
					i = matcherOut.length;
					while ( i-- ) {
						if ( (elem = matcherOut[i]) ) {
							// Restore matcherIn since elem is not yet a final match
							temp.push( (matcherIn[i] = elem) );
						}
					}
					postFinder( null, (matcherOut = []), temp, xml );
				}

				// Move matched elements from seed to results to keep them synchronized
				i = matcherOut.length;
				while ( i-- ) {
					if ( (elem = matcherOut[i]) &&
						(temp = postFinder ? indexOf.call( seed, elem ) : preMap[i]) > -1 ) {

						seed[temp] = !(results[temp] = elem);
					}
				}
			}

		// Add elements to results, through postFinder if defined
		} else {
			matcherOut = condense(
				matcherOut === results ?
					matcherOut.splice( preexisting, matcherOut.length ) :
					matcherOut
			);
			if ( postFinder ) {
				postFinder( null, results, matcherOut, xml );
			} else {
				push.apply( results, matcherOut );
			}
		}
	});
}

function matcherFromTokens( tokens ) {
	var checkContext, matcher, j,
		len = tokens.length,
		leadingRelative = Expr.relative[ tokens[0].type ],
		implicitRelative = leadingRelative || Expr.relative[" "],
		i = leadingRelative ? 1 : 0,

		// The foundational matcher ensures that elements are reachable from top-level context(s)
		matchContext = addCombinator( function( elem ) {
			return elem === checkContext;
		}, implicitRelative, true ),
		matchAnyContext = addCombinator( function( elem ) {
			return indexOf.call( checkContext, elem ) > -1;
		}, implicitRelative, true ),
		matchers = [ function( elem, context, xml ) {
			return ( !leadingRelative && ( xml || context !== outermostContext ) ) || (
				(checkContext = context).nodeType ?
					matchContext( elem, context, xml ) :
					matchAnyContext( elem, context, xml ) );
		} ];

	for ( ; i < len; i++ ) {
		if ( (matcher = Expr.relative[ tokens[i].type ]) ) {
			matchers = [ addCombinator(elementMatcher( matchers ), matcher) ];
		} else {
			matcher = Expr.filter[ tokens[i].type ].apply( null, tokens[i].matches );

			// Return special upon seeing a positional matcher
			if ( matcher[ expando ] ) {
				// Find the next relative operator (if any) for proper handling
				j = ++i;
				for ( ; j < len; j++ ) {
					if ( Expr.relative[ tokens[j].type ] ) {
						break;
					}
				}
				return setMatcher(
					i > 1 && elementMatcher( matchers ),
					i > 1 && toSelector( tokens.slice( 0, i - 1 ) ).replace( rtrim, "$1" ),
					matcher,
					i < j && matcherFromTokens( tokens.slice( i, j ) ),
					j < len && matcherFromTokens( (tokens = tokens.slice( j )) ),
					j < len && toSelector( tokens )
				);
			}
			matchers.push( matcher );
		}
	}

	return elementMatcher( matchers );
}

function matcherFromGroupMatchers( elementMatchers, setMatchers ) {
	// A counter to specify which element is currently being matched
	var matcherCachedRuns = 0,
		bySet = setMatchers.length > 0,
		byElement = elementMatchers.length > 0,
		superMatcher = function( seed, context, xml, results, expandContext ) {
			var elem, j, matcher,
				setMatched = [],
				matchedCount = 0,
				i = "0",
				unmatched = seed && [],
				outermost = expandContext != null,
				contextBackup = outermostContext,
				// We must always have either seed elements or context
				elems = seed || byElement && Expr.find["TAG"]( "*", expandContext && context.parentNode || context ),
				// Nested matchers should use non-integer dirruns
				dirrunsUnique = (dirruns += contextBackup == null ? 1 : Math.E);

			if ( outermost ) {
				outermostContext = context !== document && context;
				cachedruns = matcherCachedRuns;
			}

			// Add elements passing elementMatchers directly to results
			for ( ; (elem = elems[i]) != null; i++ ) {
				if ( byElement && elem ) {
					for ( j = 0; (matcher = elementMatchers[j]); j++ ) {
						if ( matcher( elem, context, xml ) ) {
							results.push( elem );
							break;
						}
					}
					if ( outermost ) {
						dirruns = dirrunsUnique;
						cachedruns = ++matcherCachedRuns;
					}
				}

				// Track unmatched elements for set filters
				if ( bySet ) {
					// They will have gone through all possible matchers
					if ( (elem = !matcher && elem) ) {
						matchedCount--;
					}

					// Lengthen the array for every element, matched or not
					if ( seed ) {
						unmatched.push( elem );
					}
				}
			}

			// Apply set filters to unmatched elements
			// `i` starts as a string, so matchedCount would equal "00" if there are no elements
			matchedCount += i;
			if ( bySet && i !== matchedCount ) {
				for ( j = 0; (matcher = setMatchers[j]); j++ ) {
					matcher( unmatched, setMatched, context, xml );
				}

				if ( seed ) {
					// Reintegrate element matches to eliminate the need for sorting
					if ( matchedCount > 0 ) {
						while ( i-- ) {
							if ( !(unmatched[i] || setMatched[i]) ) {
								setMatched[i] = pop.call( results );
							}
						}
					}

					// Discard index placeholder values to get only actual matches
					setMatched = condense( setMatched );
				}

				// Add matches to results
				push.apply( results, setMatched );

				// Seedless set matches succeeding multiple successful matchers stipulate sorting
				if ( outermost && !seed && setMatched.length > 0 &&
					( matchedCount + setMatchers.length ) > 1 ) {

					Sizzle.uniqueSort( results );
				}
			}

			// Override manipulation of globals by nested matchers
			if ( outermost ) {
				dirruns = dirrunsUnique;
				outermostContext = contextBackup;
			}

			return unmatched;
		};

	return bySet ?
		markFunction( superMatcher ) :
		superMatcher;
}

compile = Sizzle.compile = function( selector, group /* Internal Use Only */ ) {
	var i,
		setMatchers = [],
		elementMatchers = [],
		cached = compilerCache[ selector + " " ];

	if ( !cached ) {
		// Generate a function of recursive functions that can be used to check each element
		if ( !group ) {
			group = tokenize( selector );
		}
		i = group.length;
		while ( i-- ) {
			cached = matcherFromTokens( group[i] );
			if ( cached[ expando ] ) {
				setMatchers.push( cached );
			} else {
				elementMatchers.push( cached );
			}
		}

		// Cache the compiled function
		cached = compilerCache( selector, matcherFromGroupMatchers( elementMatchers, setMatchers ) );
	}
	return cached;
};

function multipleContexts( selector, contexts, results ) {
	var i = 0,
		len = contexts.length;
	for ( ; i < len; i++ ) {
		Sizzle( selector, contexts[i], results );
	}
	return results;
}

function select( selector, context, results, seed ) {
	var i, tokens, token, type, find,
		match = tokenize( selector );

	if ( !seed ) {
		// Try to minimize operations if there is only one group
		if ( match.length === 1 ) {

			// Take a shortcut and set the context if the root selector is an ID
			tokens = match[0] = match[0].slice( 0 );
			if ( tokens.length > 2 && (token = tokens[0]).type === "ID" &&
					context.nodeType === 9 && !documentIsXML &&
					Expr.relative[ tokens[1].type ] ) {

				context = Expr.find["ID"]( token.matches[0].replace( runescape, funescape ), context )[0];
				if ( !context ) {
					return results;
				}

				selector = selector.slice( tokens.shift().value.length );
			}

			// Fetch a seed set for right-to-left matching
			for ( i = matchExpr["needsContext"].test( selector ) ? -1 : tokens.length - 1; i >= 0; i-- ) {
				token = tokens[i];

				// Abort if we hit a combinator
				if ( Expr.relative[ (type = token.type) ] ) {
					break;
				}
				if ( (find = Expr.find[ type ]) ) {
					// Search, expanding context for leading sibling combinators
					if ( (seed = find(
						token.matches[0].replace( runescape, funescape ),
						rsibling.test( tokens[0].type ) && context.parentNode || context
					)) ) {

						// If seed is empty or no tokens remain, we can return early
						tokens.splice( i, 1 );
						selector = seed.length && toSelector( tokens );
						if ( !selector ) {
							push.apply( results, slice.call( seed, 0 ) );
							return results;
						}

						break;
					}
				}
			}
		}
	}

	// Compile and execute a filtering function
	// Provide `match` to avoid retokenization if we modified the selector above
	compile( selector, match )(
		seed,
		context,
		documentIsXML,
		results,
		rsibling.test( selector )
	);
	return results;
}

// Deprecated
Expr.pseudos["nth"] = Expr.pseudos["eq"];

// Easy API for creating new setFilters
function setFilters() {}
Expr.filters = setFilters.prototype = Expr.pseudos;
Expr.setFilters = new setFilters();

// Initialize with the default document
setDocument();

// Override sizzle attribute retrieval
Sizzle.attr = jQuery.attr;
jQuery.find = Sizzle;
jQuery.expr = Sizzle.selectors;
jQuery.expr[":"] = jQuery.expr.pseudos;
jQuery.unique = Sizzle.uniqueSort;
jQuery.text = Sizzle.getText;
jQuery.isXMLDoc = Sizzle.isXML;
jQuery.contains = Sizzle.contains;


})( window );
var runtil = /Until$/,
	rparentsprev = /^(?:parents|prev(?:Until|All))/,
	isSimple = /^.[^:#\[\.,]*$/,
	rneedsContext = jQuery.expr.match.needsContext,
	// methods guaranteed to produce a unique set when starting from a unique set
	guaranteedUnique = {
		children: true,
		contents: true,
		next: true,
		prev: true
	};

jQuery.fn.extend({
	find: function( selector ) {
		var i, ret, self;

		if ( typeof selector !== "string" ) {
			self = this;
			return this.pushStack( jQuery( selector ).filter(function() {
				for ( i = 0; i < self.length; i++ ) {
					if ( jQuery.contains( self[ i ], this ) ) {
						return true;
					}
				}
			}) );
		}

		ret = [];
		for ( i = 0; i < this.length; i++ ) {
			jQuery.find( selector, this[ i ], ret );
		}

		// Needed because $( selector, context ) becomes $( context ).find( selector )
		ret = this.pushStack( jQuery.unique( ret ) );
		ret.selector = ( this.selector ? this.selector + " " : "" ) + selector;
		return ret;
	},

	has: function( target ) {
		var i,
			targets = jQuery( target, this ),
			len = targets.length;

		return this.filter(function() {
			for ( i = 0; i < len; i++ ) {
				if ( jQuery.contains( this, targets[i] ) ) {
					return true;
				}
			}
		});
	},

	not: function( selector ) {
		return this.pushStack( winnow(this, selector, false) );
	},

	filter: function( selector ) {
		return this.pushStack( winnow(this, selector, true) );
	},

	is: function( selector ) {
		return !!selector && (
			typeof selector === "string" ?
				// If this is a positional/relative selector, check membership in the returned set
				// so $("p:first").is("p:last") won't return true for a doc with two "p".
				rneedsContext.test( selector ) ?
					jQuery( selector, this.context ).index( this[0] ) >= 0 :
					jQuery.filter( selector, this ).length > 0 :
				this.filter( selector ).length > 0 );
	},

	closest: function( selectors, context ) {
		var cur,
			i = 0,
			l = this.length,
			ret = [],
			pos = rneedsContext.test( selectors ) || typeof selectors !== "string" ?
				jQuery( selectors, context || this.context ) :
				0;

		for ( ; i < l; i++ ) {
			cur = this[i];

			while ( cur && cur.ownerDocument && cur !== context && cur.nodeType !== 11 ) {
				if ( pos ? pos.index(cur) > -1 : jQuery.find.matchesSelector(cur, selectors) ) {
					ret.push( cur );
					break;
				}
				cur = cur.parentNode;
			}
		}

		return this.pushStack( ret.length > 1 ? jQuery.unique( ret ) : ret );
	},

	// Determine the position of an element within
	// the matched set of elements
	index: function( elem ) {

		// No argument, return index in parent
		if ( !elem ) {
			return ( this[0] && this[0].parentNode ) ? this.first().prevAll().length : -1;
		}

		// index in selector
		if ( typeof elem === "string" ) {
			return jQuery.inArray( this[0], jQuery( elem ) );
		}

		// Locate the position of the desired element
		return jQuery.inArray(
			// If it receives a jQuery object, the first element is used
			elem.jquery ? elem[0] : elem, this );
	},

	add: function( selector, context ) {
		var set = typeof selector === "string" ?
				jQuery( selector, context ) :
				jQuery.makeArray( selector && selector.nodeType ? [ selector ] : selector ),
			all = jQuery.merge( this.get(), set );

		return this.pushStack( jQuery.unique(all) );
	},

	addBack: function( selector ) {
		return this.add( selector == null ?
			this.prevObject : this.prevObject.filter(selector)
		);
	}
});

jQuery.fn.andSelf = jQuery.fn.addBack;

function sibling( cur, dir ) {
	do {
		cur = cur[ dir ];
	} while ( cur && cur.nodeType !== 1 );

	return cur;
}

jQuery.each({
	parent: function( elem ) {
		var parent = elem.parentNode;
		return parent && parent.nodeType !== 11 ? parent : null;
	},
	parents: function( elem ) {
		return jQuery.dir( elem, "parentNode" );
	},
	parentsUntil: function( elem, i, until ) {
		return jQuery.dir( elem, "parentNode", until );
	},
	next: function( elem ) {
		return sibling( elem, "nextSibling" );
	},
	prev: function( elem ) {
		return sibling( elem, "previousSibling" );
	},
	nextAll: function( elem ) {
		return jQuery.dir( elem, "nextSibling" );
	},
	prevAll: function( elem ) {
		return jQuery.dir( elem, "previousSibling" );
	},
	nextUntil: function( elem, i, until ) {
		return jQuery.dir( elem, "nextSibling", until );
	},
	prevUntil: function( elem, i, until ) {
		return jQuery.dir( elem, "previousSibling", until );
	},
	siblings: function( elem ) {
		return jQuery.sibling( ( elem.parentNode || {} ).firstChild, elem );
	},
	children: function( elem ) {
		return jQuery.sibling( elem.firstChild );
	},
	contents: function( elem ) {
		return jQuery.nodeName( elem, "iframe" ) ?
			elem.contentDocument || elem.contentWindow.document :
			jQuery.merge( [], elem.childNodes );
	}
}, function( name, fn ) {
	jQuery.fn[ name ] = function( until, selector ) {
		var ret = jQuery.map( this, fn, until );

		if ( !runtil.test( name ) ) {
			selector = until;
		}

		if ( selector && typeof selector === "string" ) {
			ret = jQuery.filter( selector, ret );
		}

		ret = this.length > 1 && !guaranteedUnique[ name ] ? jQuery.unique( ret ) : ret;

		if ( this.length > 1 && rparentsprev.test( name ) ) {
			ret = ret.reverse();
		}

		return this.pushStack( ret );
	};
});

jQuery.extend({
	filter: function( expr, elems, not ) {
		if ( not ) {
			expr = ":not(" + expr + ")";
		}

		return elems.length === 1 ?
			jQuery.find.matchesSelector(elems[0], expr) ? [ elems[0] ] : [] :
			jQuery.find.matches(expr, elems);
	},

	dir: function( elem, dir, until ) {
		var matched = [],
			cur = elem[ dir ];

		while ( cur && cur.nodeType !== 9 && (until === undefined || cur.nodeType !== 1 || !jQuery( cur ).is( until )) ) {
			if ( cur.nodeType === 1 ) {
				matched.push( cur );
			}
			cur = cur[dir];
		}
		return matched;
	},

	sibling: function( n, elem ) {
		var r = [];

		for ( ; n; n = n.nextSibling ) {
			if ( n.nodeType === 1 && n !== elem ) {
				r.push( n );
			}
		}

		return r;
	}
});

// Implement the identical functionality for filter and not
function winnow( elements, qualifier, keep ) {

	// Can't pass null or undefined to indexOf in Firefox 4
	// Set to 0 to skip string check
	qualifier = qualifier || 0;

	if ( jQuery.isFunction( qualifier ) ) {
		return jQuery.grep(elements, function( elem, i ) {
			var retVal = !!qualifier.call( elem, i, elem );
			return retVal === keep;
		});

	} else if ( qualifier.nodeType ) {
		return jQuery.grep(elements, function( elem ) {
			return ( elem === qualifier ) === keep;
		});

	} else if ( typeof qualifier === "string" ) {
		var filtered = jQuery.grep(elements, function( elem ) {
			return elem.nodeType === 1;
		});

		if ( isSimple.test( qualifier ) ) {
			return jQuery.filter(qualifier, filtered, !keep);
		} else {
			qualifier = jQuery.filter( qualifier, filtered );
		}
	}

	return jQuery.grep(elements, function( elem ) {
		return ( jQuery.inArray( elem, qualifier ) >= 0 ) === keep;
	});
}
function createSafeFragment( document ) {
	var list = nodeNames.split( "|" ),
		safeFrag = document.createDocumentFragment();

	if ( safeFrag.createElement ) {
		while ( list.length ) {
			safeFrag.createElement(
				list.pop()
			);
		}
	}
	return safeFrag;
}

var nodeNames = "abbr|article|aside|audio|bdi|canvas|data|datalist|details|figcaption|figure|footer|" +
		"header|hgroup|mark|meter|nav|output|progress|section|summary|time|video",
	rinlinejQuery = / jQuery\d+="(?:null|\d+)"/g,
	rnoshimcache = new RegExp("<(?:" + nodeNames + ")[\\s/>]", "i"),
	rleadingWhitespace = /^\s+/,
	rxhtmlTag = /<(?!area|br|col|embed|hr|img|input|link|meta|param)(([\w:]+)[^>]*)\/>/gi,
	rtagName = /<([\w:]+)/,
	rtbody = /<tbody/i,
	rhtml = /<|&#?\w+;/,
	rnoInnerhtml = /<(?:script|style|link)/i,
	manipulation_rcheckableType = /^(?:checkbox|radio)$/i,
	// checked="checked" or checked
	rchecked = /checked\s*(?:[^=]|=\s*.checked.)/i,
	rscriptType = /^$|\/(?:java|ecma)script/i,
	rscriptTypeMasked = /^true\/(.*)/,
	rcleanScript = /^\s*<!(?:\[CDATA\[|--)|(?:\]\]|--)>\s*$/g,

	// We have to close these tags to support XHTML (#13200)
	wrapMap = {
		option: [ 1, "<select multiple='multiple'>", "</select>" ],
		legend: [ 1, "<fieldset>", "</fieldset>" ],
		area: [ 1, "<map>", "</map>" ],
		param: [ 1, "<object>", "</object>" ],
		thead: [ 1, "<table>", "</table>" ],
		tr: [ 2, "<table><tbody>", "</tbody></table>" ],
		col: [ 2, "<table><tbody></tbody><colgroup>", "</colgroup></table>" ],
		td: [ 3, "<table><tbody><tr>", "</tr></tbody></table>" ],

		// IE6-8 can't serialize link, script, style, or any html5 (NoScope) tags,
		// unless wrapped in a div with non-breaking characters in front of it.
		_default: jQuery.support.htmlSerialize ? [ 0, "", "" ] : [ 1, "X<div>", "</div>"  ]
	},
	safeFragment = createSafeFragment( document ),
	fragmentDiv = safeFragment.appendChild( document.createElement("div") );

wrapMap.optgroup = wrapMap.option;
wrapMap.tbody = wrapMap.tfoot = wrapMap.colgroup = wrapMap.caption = wrapMap.thead;
wrapMap.th = wrapMap.td;

jQuery.fn.extend({
	text: function( value ) {
		return jQuery.access( this, function( value ) {
			return value === undefined ?
				jQuery.text( this ) :
				this.empty().append( ( this[0] && this[0].ownerDocument || document ).createTextNode( value ) );
		}, null, value, arguments.length );
	},

	wrapAll: function( html ) {
		if ( jQuery.isFunction( html ) ) {
			return this.each(function(i) {
				jQuery(this).wrapAll( html.call(this, i) );
			});
		}

		if ( this[0] ) {
			// The elements to wrap the target around
			var wrap = jQuery( html, this[0].ownerDocument ).eq(0).clone(true);

			if ( this[0].parentNode ) {
				wrap.insertBefore( this[0] );
			}

			wrap.map(function() {
				var elem = this;

				while ( elem.firstChild && elem.firstChild.nodeType === 1 ) {
					elem = elem.firstChild;
				}

				return elem;
			}).append( this );
		}

		return this;
	},

	wrapInner: function( html ) {
		if ( jQuery.isFunction( html ) ) {
			return this.each(function(i) {
				jQuery(this).wrapInner( html.call(this, i) );
			});
		}

		return this.each(function() {
			var self = jQuery( this ),
				contents = self.contents();

			if ( contents.length ) {
				contents.wrapAll( html );

			} else {
				self.append( html );
			}
		});
	},

	wrap: function( html ) {
		var isFunction = jQuery.isFunction( html );

		return this.each(function(i) {
			jQuery( this ).wrapAll( isFunction ? html.call(this, i) : html );
		});
	},

	unwrap: function() {
		return this.parent().each(function() {
			if ( !jQuery.nodeName( this, "body" ) ) {
				jQuery( this ).replaceWith( this.childNodes );
			}
		}).end();
	},

	append: function() {
		return this.domManip(arguments, true, function( elem ) {
			if ( this.nodeType === 1 || this.nodeType === 11 || this.nodeType === 9 ) {
				this.appendChild( elem );
			}
		});
	},

	prepend: function() {
		return this.domManip(arguments, true, function( elem ) {
			if ( this.nodeType === 1 || this.nodeType === 11 || this.nodeType === 9 ) {
				this.insertBefore( elem, this.firstChild );
			}
		});
	},

	before: function() {
		return this.domManip( arguments, false, function( elem ) {
			if ( this.parentNode ) {
				this.parentNode.insertBefore( elem, this );
			}
		});
	},

	after: function() {
		return this.domManip( arguments, false, function( elem ) {
			if ( this.parentNode ) {
				this.parentNode.insertBefore( elem, this.nextSibling );
			}
		});
	},

	// keepData is for internal use only--do not document
	remove: function( selector, keepData ) {
		var elem,
			i = 0;

		for ( ; (elem = this[i]) != null; i++ ) {
			if ( !selector || jQuery.filter( selector, [ elem ] ).length > 0 ) {
				if ( !keepData && elem.nodeType === 1 ) {
					jQuery.cleanData( getAll( elem ) );
				}

				if ( elem.parentNode ) {
					if ( keepData && jQuery.contains( elem.ownerDocument, elem ) ) {
						setGlobalEval( getAll( elem, "script" ) );
					}
					elem.parentNode.removeChild( elem );
				}
			}
		}

		return this;
	},

	empty: function() {
		var elem,
			i = 0;

		for ( ; (elem = this[i]) != null; i++ ) {
			// Remove element nodes and prevent memory leaks
			if ( elem.nodeType === 1 ) {
				jQuery.cleanData( getAll( elem, false ) );
			}

			// Remove any remaining nodes
			while ( elem.firstChild ) {
				elem.removeChild( elem.firstChild );
			}

			// If this is a select, ensure that it displays empty (#12336)
			// Support: IE<9
			if ( elem.options && jQuery.nodeName( elem, "select" ) ) {
				elem.options.length = 0;
			}
		}

		return this;
	},

	clone: function( dataAndEvents, deepDataAndEvents ) {
		dataAndEvents = dataAndEvents == null ? false : dataAndEvents;
		deepDataAndEvents = deepDataAndEvents == null ? dataAndEvents : deepDataAndEvents;

		return this.map( function () {
			return jQuery.clone( this, dataAndEvents, deepDataAndEvents );
		});
	},

	html: function( value ) {
		return jQuery.access( this, function( value ) {
			var elem = this[0] || {},
				i = 0,
				l = this.length;

			if ( value === undefined ) {
				return elem.nodeType === 1 ?
					elem.innerHTML.replace( rinlinejQuery, "" ) :
					undefined;
			}

			// See if we can take a shortcut and just use innerHTML
			if ( typeof value === "string" && !rnoInnerhtml.test( value ) &&
				( jQuery.support.htmlSerialize || !rnoshimcache.test( value )  ) &&
				( jQuery.support.leadingWhitespace || !rleadingWhitespace.test( value ) ) &&
				!wrapMap[ ( rtagName.exec( value ) || ["", ""] )[1].toLowerCase() ] ) {

				value = value.replace( rxhtmlTag, "<$1></$2>" );

				try {
					for (; i < l; i++ ) {
						// Remove element nodes and prevent memory leaks
						elem = this[i] || {};
						if ( elem.nodeType === 1 ) {
							jQuery.cleanData( getAll( elem, false ) );
							elem.innerHTML = value;
						}
					}

					elem = 0;

				// If using innerHTML throws an exception, use the fallback method
				} catch(e) {}
			}

			if ( elem ) {
				this.empty().append( value );
			}
		}, null, value, arguments.length );
	},

	replaceWith: function( value ) {
		var isFunc = jQuery.isFunction( value );

		// Make sure that the elements are removed from the DOM before they are inserted
		// this can help fix replacing a parent with child elements
		if ( !isFunc && typeof value !== "string" ) {
			value = jQuery( value ).not( this ).detach();
		}

		return this.domManip( [ value ], true, function( elem ) {
			var next = this.nextSibling,
				parent = this.parentNode;

			if ( parent && this.nodeType === 1 || this.nodeType === 11 ) {

				jQuery( this ).remove();

				if ( next ) {
					next.parentNode.insertBefore( elem, next );
				} else {
					parent.appendChild( elem );
				}
			}
		});
	},

	detach: function( selector ) {
		return this.remove( selector, true );
	},

	domManip: function( args, table, callback ) {

		// Flatten any nested arrays
		args = core_concat.apply( [], args );

		var fragment, first, scripts, hasScripts, node, doc,
			i = 0,
			l = this.length,
			set = this,
			iNoClone = l - 1,
			value = args[0],
			isFunction = jQuery.isFunction( value );

		// We can't cloneNode fragments that contain checked, in WebKit
		if ( isFunction || !( l <= 1 || typeof value !== "string" || jQuery.support.checkClone || !rchecked.test( value ) ) ) {
			return this.each(function( index ) {
				var self = set.eq( index );
				if ( isFunction ) {
					args[0] = value.call( this, index, table ? self.html() : undefined );
				}
				self.domManip( args, table, callback );
			});
		}

		if ( l ) {
			fragment = jQuery.buildFragment( args, this[ 0 ].ownerDocument, false, this );
			first = fragment.firstChild;

			if ( fragment.childNodes.length === 1 ) {
				fragment = first;
			}

			if ( first ) {
				table = table && jQuery.nodeName( first, "tr" );
				scripts = jQuery.map( getAll( fragment, "script" ), disableScript );
				hasScripts = scripts.length;

				// Use the original fragment for the last item instead of the first because it can end up
				// being emptied incorrectly in certain situations (#8070).
				for ( ; i < l; i++ ) {
					node = fragment;

					if ( i !== iNoClone ) {
						node = jQuery.clone( node, true, true );

						// Keep references to cloned scripts for later restoration
						if ( hasScripts ) {
							jQuery.merge( scripts, getAll( node, "script" ) );
						}
					}

					callback.call(
						table && jQuery.nodeName( this[i], "table" ) ?
							findOrAppend( this[i], "tbody" ) :
							this[i],
						node,
						i
					);
				}

				if ( hasScripts ) {
					doc = scripts[ scripts.length - 1 ].ownerDocument;

					// Reenable scripts
					jQuery.map( scripts, restoreScript );

					// Evaluate executable scripts on first document insertion
					for ( i = 0; i < hasScripts; i++ ) {
						node = scripts[ i ];
						if ( rscriptType.test( node.type || "" ) &&
							!jQuery._data( node, "globalEval" ) && jQuery.contains( doc, node ) ) {

							if ( node.src ) {
								// Hope ajax is available...
								jQuery.ajax({
									url: node.src,
									type: "GET",
									dataType: "script",
									async: false,
									global: false,
									"throws": true
								});
							} else {
								jQuery.globalEval( ( node.text || node.textContent || node.innerHTML || "" ).replace( rcleanScript, "" ) );
							}
						}
					}
				}

				// Fix #11809: Avoid leaking memory
				fragment = first = null;
			}
		}

		return this;
	}
});

function findOrAppend( elem, tag ) {
	return elem.getElementsByTagName( tag )[0] || elem.appendChild( elem.ownerDocument.createElement( tag ) );
}

// Replace/restore the type attribute of script elements for safe DOM manipulation
function disableScript( elem ) {
	var attr = elem.getAttributeNode("type");
	elem.type = ( attr && attr.specified ) + "/" + elem.type;
	return elem;
}
function restoreScript( elem ) {
	var match = rscriptTypeMasked.exec( elem.type );
	if ( match ) {
		elem.type = match[1];
	} else {
		elem.removeAttribute("type");
	}
	return elem;
}

// Mark scripts as having already been evaluated
function setGlobalEval( elems, refElements ) {
	var elem,
		i = 0;
	for ( ; (elem = elems[i]) != null; i++ ) {
		jQuery._data( elem, "globalEval", !refElements || jQuery._data( refElements[i], "globalEval" ) );
	}
}

function cloneCopyEvent( src, dest ) {

	if ( dest.nodeType !== 1 || !jQuery.hasData( src ) ) {
		return;
	}

	var type, i, l,
		oldData = jQuery._data( src ),
		curData = jQuery._data( dest, oldData ),
		events = oldData.events;

	if ( events ) {
		delete curData.handle;
		curData.events = {};

		for ( type in events ) {
			for ( i = 0, l = events[ type ].length; i < l; i++ ) {
				jQuery.event.add( dest, type, events[ type ][ i ] );
			}
		}
	}

	// make the cloned public data object a copy from the original
	if ( curData.data ) {
		curData.data = jQuery.extend( {}, curData.data );
	}
}

function fixCloneNodeIssues( src, dest ) {
	var nodeName, data, e;

	// We do not need to do anything for non-Elements
	if ( dest.nodeType !== 1 ) {
		return;
	}

	nodeName = dest.nodeName.toLowerCase();

	// IE6-8 copies events bound via attachEvent when using cloneNode.
	if ( !jQuery.support.noCloneEvent && dest[ jQuery.expando ] ) {
		data = jQuery._data( dest );

		for ( e in data.events ) {
			jQuery.removeEvent( dest, e, data.handle );
		}

		// Event data gets referenced instead of copied if the expando gets copied too
		dest.removeAttribute( jQuery.expando );
	}

	// IE blanks contents when cloning scripts, and tries to evaluate newly-set text
	if ( nodeName === "script" && dest.text !== src.text ) {
		disableScript( dest ).text = src.text;
		restoreScript( dest );

	// IE6-10 improperly clones children of object elements using classid.
	// IE10 throws NoModificationAllowedError if parent is null, #12132.
	} else if ( nodeName === "object" ) {
		if ( dest.parentNode ) {
			dest.outerHTML = src.outerHTML;
		}

		// This path appears unavoidable for IE9. When cloning an object
		// element in IE9, the outerHTML strategy above is not sufficient.
		// If the src has innerHTML and the destination does not,
		// copy the src.innerHTML into the dest.innerHTML. #10324
		if ( jQuery.support.html5Clone && ( src.innerHTML && !jQuery.trim(dest.innerHTML) ) ) {
			dest.innerHTML = src.innerHTML;
		}

	} else if ( nodeName === "input" && manipulation_rcheckableType.test( src.type ) ) {
		// IE6-8 fails to persist the checked state of a cloned checkbox
		// or radio button. Worse, IE6-7 fail to give the cloned element
		// a checked appearance if the defaultChecked value isn't also set

		dest.defaultChecked = dest.checked = src.checked;

		// IE6-7 get confused and end up setting the value of a cloned
		// checkbox/radio button to an empty string instead of "on"
		if ( dest.value !== src.value ) {
			dest.value = src.value;
		}

	// IE6-8 fails to return the selected option to the default selected
	// state when cloning options
	} else if ( nodeName === "option" ) {
		dest.defaultSelected = dest.selected = src.defaultSelected;

	// IE6-8 fails to set the defaultValue to the correct value when
	// cloning other types of input fields
	} else if ( nodeName === "input" || nodeName === "textarea" ) {
		dest.defaultValue = src.defaultValue;
	}
}

jQuery.each({
	appendTo: "append",
	prependTo: "prepend",
	insertBefore: "before",
	insertAfter: "after",
	replaceAll: "replaceWith"
}, function( name, original ) {
	jQuery.fn[ name ] = function( selector ) {
		var elems,
			i = 0,
			ret = [],
			insert = jQuery( selector ),
			last = insert.length - 1;

		for ( ; i <= last; i++ ) {
			elems = i === last ? this : this.clone(true);
			jQuery( insert[i] )[ original ]( elems );

			// Modern browsers can apply jQuery collections as arrays, but oldIE needs a .get()
			core_push.apply( ret, elems.get() );
		}

		return this.pushStack( ret );
	};
});

function getAll( context, tag ) {
	var elems, elem,
		i = 0,
		found = typeof context.getElementsByTagName !== "undefined" ? context.getElementsByTagName( tag || "*" ) :
			typeof context.querySelectorAll !== "undefined" ? context.querySelectorAll( tag || "*" ) :
			undefined;

	if ( !found ) {
		for ( found = [], elems = context.childNodes || context; (elem = elems[i]) != null; i++ ) {
			if ( !tag || jQuery.nodeName( elem, tag ) ) {
				found.push( elem );
			} else {
				jQuery.merge( found, getAll( elem, tag ) );
			}
		}
	}

	return tag === undefined || tag && jQuery.nodeName( context, tag ) ?
		jQuery.merge( [ context ], found ) :
		found;
}

// Used in buildFragment, fixes the defaultChecked property
function fixDefaultChecked( elem ) {
	if ( manipulation_rcheckableType.test( elem.type ) ) {
		elem.defaultChecked = elem.checked;
	}
}

jQuery.extend({
	clone: function( elem, dataAndEvents, deepDataAndEvents ) {
		var destElements, srcElements, node, i, clone,
			inPage = jQuery.contains( elem.ownerDocument, elem );

		if ( jQuery.support.html5Clone || jQuery.isXMLDoc(elem) || !rnoshimcache.test( "<" + elem.nodeName + ">" ) ) {
			clone = elem.cloneNode( true );

		// IE<=8 does not properly clone detached, unknown element nodes
		} else {
			fragmentDiv.innerHTML = elem.outerHTML;
			fragmentDiv.removeChild( clone = fragmentDiv.firstChild );
		}

		if ( (!jQuery.support.noCloneEvent || !jQuery.support.noCloneChecked) &&
				(elem.nodeType === 1 || elem.nodeType === 11) && !jQuery.isXMLDoc(elem) ) {

			// We eschew Sizzle here for performance reasons: http://jsperf.com/getall-vs-sizzle/2
			destElements = getAll( clone );
			srcElements = getAll( elem );

			// Fix all IE cloning issues
			for ( i = 0; (node = srcElements[i]) != null; ++i ) {
				// Ensure that the destination node is not null; Fixes #9587
				if ( destElements[i] ) {
					fixCloneNodeIssues( node, destElements[i] );
				}
			}
		}

		// Copy the events from the original to the clone
		if ( dataAndEvents ) {
			if ( deepDataAndEvents ) {
				srcElements = srcElements || getAll( elem );
				destElements = destElements || getAll( clone );

				for ( i = 0; (node = srcElements[i]) != null; i++ ) {
					cloneCopyEvent( node, destElements[i] );
				}
			} else {
				cloneCopyEvent( elem, clone );
			}
		}

		// Preserve script evaluation history
		destElements = getAll( clone, "script" );
		if ( destElements.length > 0 ) {
			setGlobalEval( destElements, !inPage && getAll( elem, "script" ) );
		}

		destElements = srcElements = node = null;

		// Return the cloned set
		return clone;
	},

	buildFragment: function( elems, context, scripts, selection ) {
		var contains, elem, tag, tmp, wrap, tbody, j,
			l = elems.length,

			// Ensure a safe fragment
			safe = createSafeFragment( context ),

			nodes = [],
			i = 0;

		for ( ; i < l; i++ ) {
			elem = elems[ i ];

			if ( elem || elem === 0 ) {

				// Add nodes directly
				if ( jQuery.type( elem ) === "object" ) {
					jQuery.merge( nodes, elem.nodeType ? [ elem ] : elem );

				// Convert non-html into a text node
				} else if ( !rhtml.test( elem ) ) {
					nodes.push( context.createTextNode( elem ) );

				// Convert html into DOM nodes
				} else {
					tmp = tmp || safe.appendChild( context.createElement("div") );

					// Deserialize a standard representation
					tag = ( rtagName.exec( elem ) || ["", ""] )[1].toLowerCase();
					wrap = wrapMap[ tag ] || wrapMap._default;

					tmp.innerHTML = wrap[1] + elem.replace( rxhtmlTag, "<$1></$2>" ) + wrap[2];

					// Descend through wrappers to the right content
					j = wrap[0];
					while ( j-- ) {
						tmp = tmp.lastChild;
					}

					// Manually add leading whitespace removed by IE
					if ( !jQuery.support.leadingWhitespace && rleadingWhitespace.test( elem ) ) {
						nodes.push( context.createTextNode( rleadingWhitespace.exec( elem )[0] ) );
					}

					// Remove IE's autoinserted <tbody> from table fragments
					if ( !jQuery.support.tbody ) {

						// String was a <table>, *may* have spurious <tbody>
						elem = tag === "table" && !rtbody.test( elem ) ?
							tmp.firstChild :

							// String was a bare <thead> or <tfoot>
							wrap[1] === "<table>" && !rtbody.test( elem ) ?
								tmp :
								0;

						j = elem && elem.childNodes.length;
						while ( j-- ) {
							if ( jQuery.nodeName( (tbody = elem.childNodes[j]), "tbody" ) && !tbody.childNodes.length ) {
								elem.removeChild( tbody );
							}
						}
					}

					jQuery.merge( nodes, tmp.childNodes );

					// Fix #12392 for WebKit and IE > 9
					tmp.textContent = "";

					// Fix #12392 for oldIE
					while ( tmp.firstChild ) {
						tmp.removeChild( tmp.firstChild );
					}

					// Remember the top-level container for proper cleanup
					tmp = safe.lastChild;
				}
			}
		}

		// Fix #11356: Clear elements from fragment
		if ( tmp ) {
			safe.removeChild( tmp );
		}

		// Reset defaultChecked for any radios and checkboxes
		// about to be appended to the DOM in IE 6/7 (#8060)
		if ( !jQuery.support.appendChecked ) {
			jQuery.grep( getAll( nodes, "input" ), fixDefaultChecked );
		}

		i = 0;
		while ( (elem = nodes[ i++ ]) ) {

			// #4087 - If origin and destination elements are the same, and this is
			// that element, do not do anything
			if ( selection && jQuery.inArray( elem, selection ) !== -1 ) {
				continue;
			}

			contains = jQuery.contains( elem.ownerDocument, elem );

			// Append to fragment
			tmp = getAll( safe.appendChild( elem ), "script" );

			// Preserve script evaluation history
			if ( contains ) {
				setGlobalEval( tmp );
			}

			// Capture executables
			if ( scripts ) {
				j = 0;
				while ( (elem = tmp[ j++ ]) ) {
					if ( rscriptType.test( elem.type || "" ) ) {
						scripts.push( elem );
					}
				}
			}
		}

		tmp = null;

		return safe;
	},

	cleanData: function( elems, /* internal */ acceptData ) {
		var data, id, elem, type,
			i = 0,
			internalKey = jQuery.expando,
			cache = jQuery.cache,
			deleteExpando = jQuery.support.deleteExpando,
			special = jQuery.event.special;

		for ( ; (elem = elems[i]) != null; i++ ) {

			if ( acceptData || jQuery.acceptData( elem ) ) {

				id = elem[ internalKey ];
				data = id && cache[ id ];

				if ( data ) {
					if ( data.events ) {
						for ( type in data.events ) {
							if ( special[ type ] ) {
								jQuery.event.remove( elem, type );

							// This is a shortcut to avoid jQuery.event.remove's overhead
							} else {
								jQuery.removeEvent( elem, type, data.handle );
							}
						}
					}

					// Remove cache only if it was not already removed by jQuery.event.remove
					if ( cache[ id ] ) {

						delete cache[ id ];

						// IE does not allow us to delete expando properties from nodes,
						// nor does it have a removeAttribute function on Document nodes;
						// we must handle all of these cases
						if ( deleteExpando ) {
							delete elem[ internalKey ];

						} else if ( typeof elem.removeAttribute !== "undefined" ) {
							elem.removeAttribute( internalKey );

						} else {
							elem[ internalKey ] = null;
						}

						core_deletedIds.push( id );
					}
				}
			}
		}
	}
});
var curCSS, getStyles, iframe,
	ralpha = /alpha\([^)]*\)/i,
	ropacity = /opacity\s*=\s*([^)]*)/,
	rposition = /^(top|right|bottom|left)$/,
	// swappable if display is none or starts with table except "table", "table-cell", or "table-caption"
	// see here for display values: https://developer.mozilla.org/en-US/docs/CSS/display
	rdisplayswap = /^(none|table(?!-c[ea]).+)/,
	rmargin = /^margin/,
	rnumsplit = new RegExp( "^(" + core_pnum + ")(.*)$", "i" ),
	rnumnonpx = new RegExp( "^(" + core_pnum + ")(?!px)[a-z%]+$", "i" ),
	rrelNum = new RegExp( "^([+-])=(" + core_pnum + ")", "i" ),
	elemdisplay = { BODY: "block" },

	cssShow = { position: "absolute", visibility: "hidden", display: "block" },
	cssNormalTransform = {
		letterSpacing: 0,
		fontWeight: 400
	},

	cssExpand = [ "Top", "Right", "Bottom", "Left" ],
	cssPrefixes = [ "Webkit", "O", "Moz", "ms" ];

// return a css property mapped to a potentially vendor prefixed property
function vendorPropName( style, name ) {

	// shortcut for names that are not vendor prefixed
	if ( name in style ) {
		return name;
	}

	// check for vendor prefixed names
	var capName = name.charAt(0).toUpperCase() + name.slice(1),
		origName = name,
		i = cssPrefixes.length;

	while ( i-- ) {
		name = cssPrefixes[ i ] + capName;
		if ( name in style ) {
			return name;
		}
	}

	return origName;
}

function isHidden( elem, el ) {
	// isHidden might be called from jQuery#filter function;
	// in that case, element will be second argument
	elem = el || elem;
	return jQuery.css( elem, "display" ) === "none" || !jQuery.contains( elem.ownerDocument, elem );
}

function showHide( elements, show ) {
	var elem,
		values = [],
		index = 0,
		length = elements.length;

	for ( ; index < length; index++ ) {
		elem = elements[ index ];
		if ( !elem.style ) {
			continue;
		}
		values[ index ] = jQuery._data( elem, "olddisplay" );
		if ( show ) {
			// Reset the inline display of this element to learn if it is
			// being hidden by cascaded rules or not
			if ( !values[ index ] && elem.style.display === "none" ) {
				elem.style.display = "";
			}

			// Set elements which have been overridden with display: none
			// in a stylesheet to whatever the default browser style is
			// for such an element
			if ( elem.style.display === "" && isHidden( elem ) ) {
				values[ index ] = jQuery._data( elem, "olddisplay", css_defaultDisplay(elem.nodeName) );
			}
		} else if ( !values[ index ] && !isHidden( elem ) ) {
			jQuery._data( elem, "olddisplay", jQuery.css( elem, "display" ) );
		}
	}

	// Set the display of most of the elements in a second loop
	// to avoid the constant reflow
	for ( index = 0; index < length; index++ ) {
		elem = elements[ index ];
		if ( !elem.style ) {
			continue;
		}
		if ( !show || elem.style.display === "none" || elem.style.display === "" ) {
			elem.style.display = show ? values[ index ] || "" : "none";
		}
	}

	return elements;
}

jQuery.fn.extend({
	css: function( name, value ) {
		return jQuery.access( this, function( elem, name, value ) {
			var styles, len,
				map = {},
				i = 0;

			if ( jQuery.isArray( name ) ) {
				styles = getStyles( elem );
				len = name.length;

				for ( ; i < len; i++ ) {
					map[ name[ i ] ] = jQuery.css( elem, name[ i ], false, styles );
				}

				return map;
			}

			return value !== undefined ?
				jQuery.style( elem, name, value ) :
				jQuery.css( elem, name );
		}, name, value, arguments.length > 1 );
	},
	show: function() {
		return showHide( this, true );
	},
	hide: function() {
		return showHide( this );
	},
	toggle: function( state ) {
		var bool = typeof state === "boolean";

		return this.each(function() {
			if ( bool ? state : isHidden( this ) ) {
				jQuery( this ).show();
			} else {
				jQuery( this ).hide();
			}
		});
	}
});

jQuery.extend({
	// Add in style property hooks for overriding the default
	// behavior of getting and setting a style property
	cssHooks: {
		opacity: {
			get: function( elem, computed ) {
				if ( computed ) {
					// We should always get a number back from opacity
					var ret = curCSS( elem, "opacity" );
					return ret === "" ? "1" : ret;
				}
			}
		}
	},

	// Exclude the following css properties to add px
	cssNumber: {
		"columnCount": true,
		"fillOpacity": true,
		"fontWeight": true,
		"lineHeight": true,
		"opacity": true,
		"orphans": true,
		"widows": true,
		"zIndex": true,
		"zoom": true
	},

	// Add in properties whose names you wish to fix before
	// setting or getting the value
	cssProps: {
		// normalize float css property
		"float": jQuery.support.cssFloat ? "cssFloat" : "styleFloat"
	},

	// Get and set the style property on a DOM Node
	style: function( elem, name, value, extra ) {
		// Don't set styles on text and comment nodes
		if ( !elem || elem.nodeType === 3 || elem.nodeType === 8 || !elem.style ) {
			return;
		}

		// Make sure that we're working with the right name
		var ret, type, hooks,
			origName = jQuery.camelCase( name ),
			style = elem.style;

		name = jQuery.cssProps[ origName ] || ( jQuery.cssProps[ origName ] = vendorPropName( style, origName ) );

		// gets hook for the prefixed version
		// followed by the unprefixed version
		hooks = jQuery.cssHooks[ name ] || jQuery.cssHooks[ origName ];

		// Check if we're setting a value
		if ( value !== undefined ) {
			type = typeof value;

			// convert relative number strings (+= or -=) to relative numbers. #7345
			if ( type === "string" && (ret = rrelNum.exec( value )) ) {
				value = ( ret[1] + 1 ) * ret[2] + parseFloat( jQuery.css( elem, name ) );
				// Fixes bug #9237
				type = "number";
			}

			// Make sure that NaN and null values aren't set. See: #7116
			if ( value == null || type === "number" && isNaN( value ) ) {
				return;
			}

			// If a number was passed in, add 'px' to the (except for certain CSS properties)
			if ( type === "number" && !jQuery.cssNumber[ origName ] ) {
				value += "px";
			}

			// Fixes #8908, it can be done more correctly by specifing setters in cssHooks,
			// but it would mean to define eight (for every problematic property) identical functions
			if ( !jQuery.support.clearCloneStyle && value === "" && name.indexOf("background") === 0 ) {
				style[ name ] = "inherit";
			}

			// If a hook was provided, use that value, otherwise just set the specified value
			if ( !hooks || !("set" in hooks) || (value = hooks.set( elem, value, extra )) !== undefined ) {

				// Wrapped to prevent IE from throwing errors when 'invalid' values are provided
				// Fixes bug #5509
				try {
					style[ name ] = value;
				} catch(e) {}
			}

		} else {
			// If a hook was provided get the non-computed value from there
			if ( hooks && "get" in hooks && (ret = hooks.get( elem, false, extra )) !== undefined ) {
				return ret;
			}

			// Otherwise just get the value from the style object
			return style[ name ];
		}
	},

	css: function( elem, name, extra, styles ) {
		var val, num, hooks,
			origName = jQuery.camelCase( name );

		// Make sure that we're working with the right name
		name = jQuery.cssProps[ origName ] || ( jQuery.cssProps[ origName ] = vendorPropName( elem.style, origName ) );

		// gets hook for the prefixed version
		// followed by the unprefixed version
		hooks = jQuery.cssHooks[ name ] || jQuery.cssHooks[ origName ];

		// If a hook was provided get the computed value from there
		if ( hooks && "get" in hooks ) {
			val = hooks.get( elem, true, extra );
		}

		// Otherwise, if a way to get the computed value exists, use that
		if ( val === undefined ) {
			val = curCSS( elem, name, styles );
		}

		//convert "normal" to computed value
		if ( val === "normal" && name in cssNormalTransform ) {
			val = cssNormalTransform[ name ];
		}

		// Return, converting to number if forced or a qualifier was provided and val looks numeric
		if ( extra ) {
			num = parseFloat( val );
			return extra === true || jQuery.isNumeric( num ) ? num || 0 : val;
		}
		return val;
	},

	// A method for quickly swapping in/out CSS properties to get correct calculations
	swap: function( elem, options, callback, args ) {
		var ret, name,
			old = {};

		// Remember the old values, and insert the new ones
		for ( name in options ) {
			old[ name ] = elem.style[ name ];
			elem.style[ name ] = options[ name ];
		}

		ret = callback.apply( elem, args || [] );

		// Revert the old values
		for ( name in options ) {
			elem.style[ name ] = old[ name ];
		}

		return ret;
	}
});

// NOTE: we've included the "window" in window.getComputedStyle
// because jsdom on node.js will break without it.
if ( window.getComputedStyle ) {
	getStyles = function( elem ) {
		return window.getComputedStyle( elem, null );
	};

	curCSS = function( elem, name, _computed ) {
		var width, minWidth, maxWidth,
			computed = _computed || getStyles( elem ),

			// getPropertyValue is only needed for .css('filter') in IE9, see #12537
			ret = computed ? computed.getPropertyValue( name ) || computed[ name ] : undefined,
			style = elem.style;

		if ( computed ) {

			if ( ret === "" && !jQuery.contains( elem.ownerDocument, elem ) ) {
				ret = jQuery.style( elem, name );
			}

			// A tribute to the "awesome hack by Dean Edwards"
			// Chrome < 17 and Safari 5.0 uses "computed value" instead of "used value" for margin-right
			// Safari 5.1.7 (at least) returns percentage for a larger set of values, but width seems to be reliably pixels
			// this is against the CSSOM draft spec: http://dev.w3.org/csswg/cssom/#resolved-values
			if ( rnumnonpx.test( ret ) && rmargin.test( name ) ) {

				// Remember the original values
				width = style.width;
				minWidth = style.minWidth;
				maxWidth = style.maxWidth;

				// Put in the new values to get a computed value out
				style.minWidth = style.maxWidth = style.width = ret;
				ret = computed.width;

				// Revert the changed values
				style.width = width;
				style.minWidth = minWidth;
				style.maxWidth = maxWidth;
			}
		}

		return ret;
	};
} else if ( document.documentElement.currentStyle ) {
	getStyles = function( elem ) {
		return elem.currentStyle;
	};

	curCSS = function( elem, name, _computed ) {
		var left, rs, rsLeft,
			computed = _computed || getStyles( elem ),
			ret = computed ? computed[ name ] : undefined,
			style = elem.style;

		// Avoid setting ret to empty string here
		// so we don't default to auto
		if ( ret == null && style && style[ name ] ) {
			ret = style[ name ];
		}

		// From the awesome hack by Dean Edwards
		// http://erik.eae.net/archives/2007/07/27/18.54.15/#comment-102291

		// If we're not dealing with a regular pixel number
		// but a number that has a weird ending, we need to convert it to pixels
		// but not position css attributes, as those are proportional to the parent element instead
		// and we can't measure the parent instead because it might trigger a "stacking dolls" problem
		if ( rnumnonpx.test( ret ) && !rposition.test( name ) ) {

			// Remember the original values
			left = style.left;
			rs = elem.runtimeStyle;
			rsLeft = rs && rs.left;

			// Put in the new values to get a computed value out
			if ( rsLeft ) {
				rs.left = elem.currentStyle.left;
			}
			style.left = name === "fontSize" ? "1em" : ret;
			ret = style.pixelLeft + "px";

			// Revert the changed values
			style.left = left;
			if ( rsLeft ) {
				rs.left = rsLeft;
			}
		}

		return ret === "" ? "auto" : ret;
	};
}

function setPositiveNumber( elem, value, subtract ) {
	var matches = rnumsplit.exec( value );
	return matches ?
		// Guard against undefined "subtract", e.g., when used as in cssHooks
		Math.max( 0, matches[ 1 ] - ( subtract || 0 ) ) + ( matches[ 2 ] || "px" ) :
		value;
}

function augmentWidthOrHeight( elem, name, extra, isBorderBox, styles ) {
	var i = extra === ( isBorderBox ? "border" : "content" ) ?
		// If we already have the right measurement, avoid augmentation
		4 :
		// Otherwise initialize for horizontal or vertical properties
		name === "width" ? 1 : 0,

		val = 0;

	for ( ; i < 4; i += 2 ) {
		// both box models exclude margin, so add it if we want it
		if ( extra === "margin" ) {
			val += jQuery.css( elem, extra + cssExpand[ i ], true, styles );
		}

		if ( isBorderBox ) {
			// border-box includes padding, so remove it if we want content
			if ( extra === "content" ) {
				val -= jQuery.css( elem, "padding" + cssExpand[ i ], true, styles );
			}

			// at this point, extra isn't border nor margin, so remove border
			if ( extra !== "margin" ) {
				val -= jQuery.css( elem, "border" + cssExpand[ i ] + "Width", true, styles );
			}
		} else {
			// at this point, extra isn't content, so add padding
			val += jQuery.css( elem, "padding" + cssExpand[ i ], true, styles );

			// at this point, extra isn't content nor padding, so add border
			if ( extra !== "padding" ) {
				val += jQuery.css( elem, "border" + cssExpand[ i ] + "Width", true, styles );
			}
		}
	}

	return val;
}

function getWidthOrHeight( elem, name, extra ) {

	// Start with offset property, which is equivalent to the border-box value
	var valueIsBorderBox = true,
		val = name === "width" ? elem.offsetWidth : elem.offsetHeight,
		styles = getStyles( elem ),
		isBorderBox = jQuery.support.boxSizing && jQuery.css( elem, "boxSizing", false, styles ) === "border-box";

	// some non-html elements return undefined for offsetWidth, so check for null/undefined
	// svg - https://bugzilla.mozilla.org/show_bug.cgi?id=649285
	// MathML - https://bugzilla.mozilla.org/show_bug.cgi?id=491668
	if ( val <= 0 || val == null ) {
		// Fall back to computed then uncomputed css if necessary
		val = curCSS( elem, name, styles );
		if ( val < 0 || val == null ) {
			val = elem.style[ name ];
		}

		// Computed unit is not pixels. Stop here and return.
		if ( rnumnonpx.test(val) ) {
			return val;
		}

		// we need the check for style in case a browser which returns unreliable values
		// for getComputedStyle silently falls back to the reliable elem.style
		valueIsBorderBox = isBorderBox && ( jQuery.support.boxSizingReliable || val === elem.style[ name ] );

		// Normalize "", auto, and prepare for extra
		val = parseFloat( val ) || 0;
	}

	// use the active box-sizing model to add/subtract irrelevant styles
	return ( val +
		augmentWidthOrHeight(
			elem,
			name,
			extra || ( isBorderBox ? "border" : "content" ),
			valueIsBorderBox,
			styles
		)
	) + "px";
}

// Try to determine the default display value of an element
function css_defaultDisplay( nodeName ) {
	var doc = document,
		display = elemdisplay[ nodeName ];

	if ( !display ) {
		display = actualDisplay( nodeName, doc );

		// If the simple way fails, read from inside an iframe
		if ( display === "none" || !display ) {
			// Use the already-created iframe if possible
			iframe = ( iframe ||
				jQuery("<iframe frameborder='0' width='0' height='0'/>")
				.css( "cssText", "display:block !important" )
			).appendTo( doc.documentElement );

			// Always write a new HTML skeleton so Webkit and Firefox don't choke on reuse
			doc = ( iframe[0].contentWindow || iframe[0].contentDocument ).document;
			doc.write("<!doctype html><html><body>");
			doc.close();

			display = actualDisplay( nodeName, doc );
			iframe.detach();
		}

		// Store the correct default display
		elemdisplay[ nodeName ] = display;
	}

	return display;
}

// Called ONLY from within css_defaultDisplay
function actualDisplay( name, doc ) {
	var elem = jQuery( doc.createElement( name ) ).appendTo( doc.body ),
		display = jQuery.css( elem[0], "display" );
	elem.remove();
	return display;
}

jQuery.each([ "height", "width" ], function( i, name ) {
	jQuery.cssHooks[ name ] = {
		get: function( elem, computed, extra ) {
			if ( computed ) {
				// certain elements can have dimension info if we invisibly show them
				// however, it must have a current display style that would benefit from this
				return elem.offsetWidth === 0 && rdisplayswap.test( jQuery.css( elem, "display" ) ) ?
					jQuery.swap( elem, cssShow, function() {
						return getWidthOrHeight( elem, name, extra );
					}) :
					getWidthOrHeight( elem, name, extra );
			}
		},

		set: function( elem, value, extra ) {
			var styles = extra && getStyles( elem );
			return setPositiveNumber( elem, value, extra ?
				augmentWidthOrHeight(
					elem,
					name,
					extra,
					jQuery.support.boxSizing && jQuery.css( elem, "boxSizing", false, styles ) === "border-box",
					styles
				) : 0
			);
		}
	};
});

if ( !jQuery.support.opacity ) {
	jQuery.cssHooks.opacity = {
		get: function( elem, computed ) {
			// IE uses filters for opacity
			return ropacity.test( (computed && elem.currentStyle ? elem.currentStyle.filter : elem.style.filter) || "" ) ?
				( 0.01 * parseFloat( RegExp.$1 ) ) + "" :
				computed ? "1" : "";
		},

		set: function( elem, value ) {
			var style = elem.style,
				currentStyle = elem.currentStyle,
				opacity = jQuery.isNumeric( value ) ? "alpha(opacity=" + value * 100 + ")" : "",
				filter = currentStyle && currentStyle.filter || style.filter || "";

			// IE has trouble with opacity if it does not have layout
			// Force it by setting the zoom level
			style.zoom = 1;

			// if setting opacity to 1, and no other filters exist - attempt to remove filter attribute #6652
			// if value === "", then remove inline opacity #12685
			if ( ( value >= 1 || value === "" ) &&
					jQuery.trim( filter.replace( ralpha, "" ) ) === "" &&
					style.removeAttribute ) {

				// Setting style.filter to null, "" & " " still leave "filter:" in the cssText
				// if "filter:" is present at all, clearType is disabled, we want to avoid this
				// style.removeAttribute is IE Only, but so apparently is this code path...
				style.removeAttribute( "filter" );

				// if there is no filter style applied in a css rule or unset inline opacity, we are done
				if ( value === "" || currentStyle && !currentStyle.filter ) {
					return;
				}
			}

			// otherwise, set new filter values
			style.filter = ralpha.test( filter ) ?
				filter.replace( ralpha, opacity ) :
				filter + " " + opacity;
		}
	};
}

// These hooks cannot be added until DOM ready because the support test
// for it is not run until after DOM ready
jQuery(function() {
	if ( !jQuery.support.reliableMarginRight ) {
		jQuery.cssHooks.marginRight = {
			get: function( elem, computed ) {
				if ( computed ) {
					// WebKit Bug 13343 - getComputedStyle returns wrong value for margin-right
					// Work around by temporarily setting element display to inline-block
					return jQuery.swap( elem, { "display": "inline-block" },
						curCSS, [ elem, "marginRight" ] );
				}
			}
		};
	}

	// Webkit bug: https://bugs.webkit.org/show_bug.cgi?id=29084
	// getComputedStyle returns percent when specified for top/left/bottom/right
	// rather than make the css module depend on the offset module, we just check for it here
	if ( !jQuery.support.pixelPosition && jQuery.fn.position ) {
		jQuery.each( [ "top", "left" ], function( i, prop ) {
			jQuery.cssHooks[ prop ] = {
				get: function( elem, computed ) {
					if ( computed ) {
						computed = curCSS( elem, prop );
						// if curCSS returns percentage, fallback to offset
						return rnumnonpx.test( computed ) ?
							jQuery( elem ).position()[ prop ] + "px" :
							computed;
					}
				}
			};
		});
	}

});

if ( jQuery.expr && jQuery.expr.filters ) {
	jQuery.expr.filters.hidden = function( elem ) {
		return ( elem.offsetWidth === 0 && elem.offsetHeight === 0 ) || (!jQuery.support.reliableHiddenOffsets && ((elem.style && elem.style.display) || jQuery.css( elem, "display" )) === "none");
	};

	jQuery.expr.filters.visible = function( elem ) {
		return !jQuery.expr.filters.hidden( elem );
	};
}

// These hooks are used by animate to expand properties
jQuery.each({
	margin: "",
	padding: "",
	border: "Width"
}, function( prefix, suffix ) {
	jQuery.cssHooks[ prefix + suffix ] = {
		expand: function( value ) {
			var i = 0,
				expanded = {},

				// assumes a single number if not a string
				parts = typeof value === "string" ? value.split(" ") : [ value ];

			for ( ; i < 4; i++ ) {
				expanded[ prefix + cssExpand[ i ] + suffix ] =
					parts[ i ] || parts[ i - 2 ] || parts[ 0 ];
			}

			return expanded;
		}
	};

	if ( !rmargin.test( prefix ) ) {
		jQuery.cssHooks[ prefix + suffix ].set = setPositiveNumber;
	}
});
var r20 = /%20/g,
	rbracket = /\[\]$/,
	rCRLF = /\r?\n/g,
	rsubmitterTypes = /^(?:submit|button|image|reset)$/i,
	rsubmittable = /^(?:input|select|textarea|keygen)/i;

jQuery.fn.extend({
	serialize: function() {
		return jQuery.param( this.serializeArray() );
	},
	serializeArray: function() {
		return this.map(function(){
			// Can add propHook for "elements" to filter or add form elements
			var elements = jQuery.prop( this, "elements" );
			return elements ? jQuery.makeArray( elements ) : this;
		})
		.filter(function(){
			var type = this.type;
			// Use .is(":disabled") so that fieldset[disabled] works
			return this.name && !jQuery( this ).is( ":disabled" ) &&
				rsubmittable.test( this.nodeName ) && !rsubmitterTypes.test( type ) &&
				( this.checked || !manipulation_rcheckableType.test( type ) );
		})
		.map(function( i, elem ){
			var val = jQuery( this ).val();

			return val == null ?
				null :
				jQuery.isArray( val ) ?
					jQuery.map( val, function( val ){
						return { name: elem.name, value: val.replace( rCRLF, "\r\n" ) };
					}) :
					{ name: elem.name, value: val.replace( rCRLF, "\r\n" ) };
		}).get();
	}
});

//Serialize an array of form elements or a set of
//key/values into a query string
jQuery.param = function( a, traditional ) {
	var prefix,
		s = [],
		add = function( key, value ) {
			// If value is a function, invoke it and return its value
			value = jQuery.isFunction( value ) ? value() : ( value == null ? "" : value );
			s[ s.length ] = encodeURIComponent( key ) + "=" + encodeURIComponent( value );
		};

	// Set traditional to true for jQuery <= 1.3.2 behavior.
	if ( traditional === undefined ) {
		traditional = jQuery.ajaxSettings && jQuery.ajaxSettings.traditional;
	}

	// If an array was passed in, assume that it is an array of form elements.
	if ( jQuery.isArray( a ) || ( a.jquery && !jQuery.isPlainObject( a ) ) ) {
		// Serialize the form elements
		jQuery.each( a, function() {
			add( this.name, this.value );
		});

	} else {
		// If traditional, encode the "old" way (the way 1.3.2 or older
		// did it), otherwise encode params recursively.
		for ( prefix in a ) {
			buildParams( prefix, a[ prefix ], traditional, add );
		}
	}

	// Return the resulting serialization
	return s.join( "&" ).replace( r20, "+" );
};

function buildParams( prefix, obj, traditional, add ) {
	var name;

	if ( jQuery.isArray( obj ) ) {
		// Serialize array item.
		jQuery.each( obj, function( i, v ) {
			if ( traditional || rbracket.test( prefix ) ) {
				// Treat each array item as a scalar.
				add( prefix, v );

			} else {
				// Item is non-scalar (array or object), encode its numeric index.
				buildParams( prefix + "[" + ( typeof v === "object" ? i : "" ) + "]", v, traditional, add );
			}
		});

	} else if ( !traditional && jQuery.type( obj ) === "object" ) {
		// Serialize object item.
		for ( name in obj ) {
			buildParams( prefix + "[" + name + "]", obj[ name ], traditional, add );
		}

	} else {
		// Serialize scalar item.
		add( prefix, obj );
	}
}
var
	// Document location
	ajaxLocParts,
	ajaxLocation,
	
	ajax_nonce = jQuery.now(),

	ajax_rquery = /\?/,
	rhash = /#.*$/,
	rts = /([?&])_=[^&]*/,
	rheaders = /^(.*?):[ \t]*([^\r\n]*)\r?$/mg, // IE leaves an \r character at EOL
	// #7653, #8125, #8152: local protocol detection
	rlocalProtocol = /^(?:about|app|app-storage|.+-extension|file|res|widget):$/,
	rnoContent = /^(?:GET|HEAD)$/,
	rprotocol = /^\/\//,
	rurl = /^([\w.+-]+:)(?:\/\/([^\/?#:]*)(?::(\d+)|)|)/,

	// Keep a copy of the old load method
	_load = jQuery.fn.load,

	/* Prefilters
	 * 1) They are useful to introduce custom dataTypes (see ajax/jsonp.js for an example)
	 * 2) These are called:
	 *    - BEFORE asking for a transport
	 *    - AFTER param serialization (s.data is a string if s.processData is true)
	 * 3) key is the dataType
	 * 4) the catchall symbol "*" can be used
	 * 5) execution will start with transport dataType and THEN continue down to "*" if needed
	 */
	prefilters = {},

	/* Transports bindings
	 * 1) key is the dataType
	 * 2) the catchall symbol "*" can be used
	 * 3) selection will start with transport dataType and THEN go to "*" if needed
	 */
	transports = {},

	// Avoid comment-prolog char sequence (#10098); must appease lint and evade compression
	allTypes = "*/".concat("*");

// #8138, IE may throw an exception when accessing
// a field from window.location if document.domain has been set
try {
	ajaxLocation = location.href;
} catch( e ) {
	// Use the href attribute of an A element
	// since IE will modify it given document.location
	ajaxLocation = document.createElement( "a" );
	ajaxLocation.href = "";
	ajaxLocation = ajaxLocation.href;
}

// Segment location into parts
ajaxLocParts = rurl.exec( ajaxLocation.toLowerCase() ) || [];

// Base "constructor" for jQuery.ajaxPrefilter and jQuery.ajaxTransport
function addToPrefiltersOrTransports( structure ) {

	// dataTypeExpression is optional and defaults to "*"
	return function( dataTypeExpression, func ) {

		if ( typeof dataTypeExpression !== "string" ) {
			func = dataTypeExpression;
			dataTypeExpression = "*";
		}

		var dataType,
			i = 0,
			dataTypes = dataTypeExpression.toLowerCase().match( core_rnotwhite ) || [];

		if ( jQuery.isFunction( func ) ) {
			// For each dataType in the dataTypeExpression
			while ( (dataType = dataTypes[i++]) ) {
				// Prepend if requested
				if ( dataType[0] === "+" ) {
					dataType = dataType.slice( 1 ) || "*";
					(structure[ dataType ] = structure[ dataType ] || []).unshift( func );

				// Otherwise append
				} else {
					(structure[ dataType ] = structure[ dataType ] || []).push( func );
				}
			}
		}
	};
}

// Base inspection function for prefilters and transports
function inspectPrefiltersOrTransports( structure, options, originalOptions, jqXHR ) {

	var inspected = {},
		seekingTransport = ( structure === transports );

	function inspect( dataType ) {
		var selected;
		inspected[ dataType ] = true;
		jQuery.each( structure[ dataType ] || [], function( _, prefilterOrFactory ) {
			var dataTypeOrTransport = prefilterOrFactory( options, originalOptions, jqXHR );
			if( typeof dataTypeOrTransport === "string" && !seekingTransport && !inspected[ dataTypeOrTransport ] ) {
				options.dataTypes.unshift( dataTypeOrTransport );
				inspect( dataTypeOrTransport );
				return false;
			} else if ( seekingTransport ) {
				return !( selected = dataTypeOrTransport );
			}
		});
		return selected;
	}

	return inspect( options.dataTypes[ 0 ] ) || !inspected[ "*" ] && inspect( "*" );
}

// A special extend for ajax options
// that takes "flat" options (not to be deep extended)
// Fixes #9887
function ajaxExtend( target, src ) {
	var key, deep,
		flatOptions = jQuery.ajaxSettings.flatOptions || {};

	for ( key in src ) {
		if ( src[ key ] !== undefined ) {
			( flatOptions[ key ] ? target : ( deep || (deep = {}) ) )[ key ] = src[ key ];
		}
	}
	if ( deep ) {
		jQuery.extend( true, target, deep );
	}

	return target;
}

jQuery.fn.load = function( url, params, callback ) {
	if ( typeof url !== "string" && _load ) {
		return _load.apply( this, arguments );
	}

	var selector, type, response,
		self = this,
		off = url.indexOf(" ");

	if ( off >= 0 ) {
		selector = url.slice( off, url.length );
		url = url.slice( 0, off );
	}

	// If it's a function
	if ( jQuery.isFunction( params ) ) {

		// We assume that it's the callback
		callback = params;
		params = undefined;

	// Otherwise, build a param string
	} else if ( params && typeof params === "object" ) {
		type = "POST";
	}

	// If we have elements to modify, make the request
	if ( self.length > 0 ) {
		jQuery.ajax({
			url: url,

			// if "type" variable is undefined, then "GET" method will be used
			type: type,
			dataType: "html",
			data: params
		}).done(function( responseText ) {

			// Save response for use in complete callback
			response = arguments;

			self.html( selector ?

				// If a selector was specified, locate the right elements in a dummy div
				// Exclude scripts to avoid IE 'Permission Denied' errors
				jQuery("<div>").append( jQuery.parseHTML( responseText ) ).find( selector ) :

				// Otherwise use the full result
				responseText );

		}).complete( callback && function( jqXHR, status ) {
			self.each( callback, response || [ jqXHR.responseText, status, jqXHR ] );
		});
	}

	return this;
};

// Attach a bunch of functions for handling common AJAX events
jQuery.each( [ "ajaxStart", "ajaxStop", "ajaxComplete", "ajaxError", "ajaxSuccess", "ajaxSend" ], function( i, type ){
	jQuery.fn[ type ] = function( fn ){
		return this.on( type, fn );
	};
});

jQuery.each( [ "get", "post" ], function( i, method ) {
	jQuery[ method ] = function( url, data, callback, type ) {
		// shift arguments if data argument was omitted
		if ( jQuery.isFunction( data ) ) {
			type = type || callback;
			callback = data;
			data = undefined;
		}

		return jQuery.ajax({
			url: url,
			type: method,
			dataType: type,
			data: data,
			success: callback
		});
	};
});

jQuery.extend({

	// Counter for holding the number of active queries
	active: 0,

	// Last-Modified header cache for next request
	lastModified: {},
	etag: {},

	ajaxSettings: {
		url: ajaxLocation,
		type: "GET",
		isLocal: rlocalProtocol.test( ajaxLocParts[ 1 ] ),
		global: true,
		processData: true,
		async: true,
		contentType: "application/x-www-form-urlencoded; charset=UTF-8",
		/*
		timeout: 0,
		data: null,
		dataType: null,
		username: null,
		password: null,
		cache: null,
		throws: false,
		traditional: false,
		headers: {},
		*/

		accepts: {
			"*": allTypes,
			text: "text/plain",
			html: "text/html",
			xml: "application/xml, text/xml",
			json: "application/json, text/javascript"
		},

		contents: {
			xml: /xml/,
			html: /html/,
			json: /json/
		},

		responseFields: {
			xml: "responseXML",
			text: "responseText"
		},

		// Data converters
		// Keys separate source (or catchall "*") and destination types with a single space
		converters: {

			// Convert anything to text
			"* text": window.String,

			// Text to html (true = no transformation)
			"text html": true,

			// Evaluate text as a json expression
			"text json": jQuery.parseJSON,

			// Parse text as xml
			"text xml": jQuery.parseXML
		},

		// For options that shouldn't be deep extended:
		// you can add your own custom options here if
		// and when you create one that shouldn't be
		// deep extended (see ajaxExtend)
		flatOptions: {
			url: true,
			context: true
		}
	},

	// Creates a full fledged settings object into target
	// with both ajaxSettings and settings fields.
	// If target is omitted, writes into ajaxSettings.
	ajaxSetup: function( target, settings ) {
		return settings ?

			// Building a settings object
			ajaxExtend( ajaxExtend( target, jQuery.ajaxSettings ), settings ) :

			// Extending ajaxSettings
			ajaxExtend( jQuery.ajaxSettings, target );
	},

	ajaxPrefilter: addToPrefiltersOrTransports( prefilters ),
	ajaxTransport: addToPrefiltersOrTransports( transports ),

	// Main method
	ajax: function( url, options ) {

		// If url is an object, simulate pre-1.5 signature
		if ( typeof url === "object" ) {
			options = url;
			url = undefined;
		}

		// Force options to be an object
		options = options || {};

		var transport,
			// URL without anti-cache param
			cacheURL,
			// Response headers
			responseHeadersString,
			responseHeaders,
			// timeout handle
			timeoutTimer,
			// Cross-domain detection vars
			parts,
			// To know if global events are to be dispatched
			fireGlobals,
			// Loop variable
			i,
			// Create the final options object
			s = jQuery.ajaxSetup( {}, options ),
			// Callbacks context
			callbackContext = s.context || s,
			// Context for global events is callbackContext if it is a DOM node or jQuery collection
			globalEventContext = s.context && ( callbackContext.nodeType || callbackContext.jquery ) ?
				jQuery( callbackContext ) :
				jQuery.event,
			// Deferreds
			deferred = jQuery.Deferred(),
			completeDeferred = jQuery.Callbacks("once memory"),
			// Status-dependent callbacks
			statusCode = s.statusCode || {},
			// Headers (they are sent all at once)
			requestHeaders = {},
			requestHeadersNames = {},
			// The jqXHR state
			state = 0,
			// Default abort message
			strAbort = "canceled",
			// Fake xhr
			jqXHR = {
				readyState: 0,

				// Builds headers hashtable if needed
				getResponseHeader: function( key ) {
					var match;
					if ( state === 2 ) {
						if ( !responseHeaders ) {
							responseHeaders = {};
							while ( (match = rheaders.exec( responseHeadersString )) ) {
								responseHeaders[ match[1].toLowerCase() ] = match[ 2 ];
							}
						}
						match = responseHeaders[ key.toLowerCase() ];
					}
					return match == null ? null : match;
				},

				// Raw string
				getAllResponseHeaders: function() {
					return state === 2 ? responseHeadersString : null;
				},

				// Caches the header
				setRequestHeader: function( name, value ) {
					var lname = name.toLowerCase();
					if ( !state ) {
						name = requestHeadersNames[ lname ] = requestHeadersNames[ lname ] || name;
						requestHeaders[ name ] = value;
					}
					return this;
				},

				// Overrides response content-type header
				overrideMimeType: function( type ) {
					if ( !state ) {
						s.mimeType = type;
					}
					return this;
				},

				// Status-dependent callbacks
				statusCode: function( map ) {
					var code;
					if ( map ) {
						if ( state < 2 ) {
							for ( code in map ) {
								// Lazy-add the new callback in a way that preserves old ones
								statusCode[ code ] = [ statusCode[ code ], map[ code ] ];
							}
						} else {
							// Execute the appropriate callbacks
							jqXHR.always( map[ jqXHR.status ] );
						}
					}
					return this;
				},

				// Cancel the request
				abort: function( statusText ) {
					var finalText = statusText || strAbort;
					if ( transport ) {
						transport.abort( finalText );
					}
					done( 0, finalText );
					return this;
				}
			};

		// Attach deferreds
		deferred.promise( jqXHR ).complete = completeDeferred.add;
		jqXHR.success = jqXHR.done;
		jqXHR.error = jqXHR.fail;

		// Remove hash character (#7531: and string promotion)
		// Add protocol if not provided (#5866: IE7 issue with protocol-less urls)
		// Handle falsy url in the settings object (#10093: consistency with old signature)
		// We also use the url parameter if available
		s.url = ( ( url || s.url || ajaxLocation ) + "" ).replace( rhash, "" ).replace( rprotocol, ajaxLocParts[ 1 ] + "//" );

		// Alias method option to type as per ticket #12004
		s.type = options.method || options.type || s.method || s.type;

		// Extract dataTypes list
		s.dataTypes = jQuery.trim( s.dataType || "*" ).toLowerCase().match( core_rnotwhite ) || [""];

		// A cross-domain request is in order when we have a protocol:host:port mismatch
		if ( s.crossDomain == null ) {
			parts = rurl.exec( s.url.toLowerCase() );
			s.crossDomain = !!( parts &&
				( parts[ 1 ] !== ajaxLocParts[ 1 ] || parts[ 2 ] !== ajaxLocParts[ 2 ] ||
					( parts[ 3 ] || ( parts[ 1 ] === "http:" ? 80 : 443 ) ) !=
						( ajaxLocParts[ 3 ] || ( ajaxLocParts[ 1 ] === "http:" ? 80 : 443 ) ) )
			);
		}

		// Convert data if not already a string
		if ( s.data && s.processData && typeof s.data !== "string" ) {
			s.data = jQuery.param( s.data, s.traditional );
		}

		// Apply prefilters
		inspectPrefiltersOrTransports( prefilters, s, options, jqXHR );

		// If request was aborted inside a prefilter, stop there
		if ( state === 2 ) {
			return jqXHR;
		}

		// We can fire global events as of now if asked to
		fireGlobals = s.global;

		// Watch for a new set of requests
		if ( fireGlobals && jQuery.active++ === 0 ) {
			jQuery.event.trigger("ajaxStart");
		}

		// Uppercase the type
		s.type = s.type.toUpperCase();

		// Determine if request has content
		s.hasContent = !rnoContent.test( s.type );

		// Save the URL in case we're toying with the If-Modified-Since
		// and/or If-None-Match header later on
		cacheURL = s.url;

		// More options handling for requests with no content
		if ( !s.hasContent ) {

			// If data is available, append data to url
			if ( s.data ) {
				cacheURL = ( s.url += ( ajax_rquery.test( cacheURL ) ? "&" : "?" ) + s.data );
				// #9682: remove data so that it's not used in an eventual retry
				delete s.data;
			}

			// Add anti-cache in url if needed
			if ( s.cache === false ) {
				s.url = rts.test( cacheURL ) ?

					// If there is already a '_' parameter, set its value
					cacheURL.replace( rts, "$1_=" + ajax_nonce++ ) :

					// Otherwise add one to the end
					cacheURL + ( ajax_rquery.test( cacheURL ) ? "&" : "?" ) + "_=" + ajax_nonce++;
			}
		}

		// Set the If-Modified-Since and/or If-None-Match header, if in ifModified mode.
		if ( s.ifModified ) {
			if ( jQuery.lastModified[ cacheURL ] ) {
				jqXHR.setRequestHeader( "If-Modified-Since", jQuery.lastModified[ cacheURL ] );
			}
			if ( jQuery.etag[ cacheURL ] ) {
				jqXHR.setRequestHeader( "If-None-Match", jQuery.etag[ cacheURL ] );
			}
		}

		// Set the correct header, if data is being sent
		if ( s.data && s.hasContent && s.contentType !== false || options.contentType ) {
			jqXHR.setRequestHeader( "Content-Type", s.contentType );
		}

		// Set the Accepts header for the server, depending on the dataType
		jqXHR.setRequestHeader(
			"Accept",
			s.dataTypes[ 0 ] && s.accepts[ s.dataTypes[0] ] ?
				s.accepts[ s.dataTypes[0] ] + ( s.dataTypes[ 0 ] !== "*" ? ", " + allTypes + "; q=0.01" : "" ) :
				s.accepts[ "*" ]
		);

		// Check for headers option
		for ( i in s.headers ) {
			jqXHR.setRequestHeader( i, s.headers[ i ] );
		}

		// Allow custom headers/mimetypes and early abort
		if ( s.beforeSend && ( s.beforeSend.call( callbackContext, jqXHR, s ) === false || state === 2 ) ) {
			// Abort if not done already and return
			return jqXHR.abort();
		}

		// aborting is no longer a cancellation
		strAbort = "abort";

		// Install callbacks on deferreds
		for ( i in { success: 1, error: 1, complete: 1 } ) {
			jqXHR[ i ]( s[ i ] );
		}

		// Get transport
		transport = inspectPrefiltersOrTransports( transports, s, options, jqXHR );

		// If no transport, we auto-abort
		if ( !transport ) {
			done( -1, "No Transport" );
		} else {
			jqXHR.readyState = 1;

			// Send global event
			if ( fireGlobals ) {
				globalEventContext.trigger( "ajaxSend", [ jqXHR, s ] );
			}
			// Timeout
			if ( s.async && s.timeout > 0 ) {
				timeoutTimer = setTimeout(function() {
					jqXHR.abort("timeout");
				}, s.timeout );
			}

			try {
				state = 1;
				transport.send( requestHeaders, done );
			} catch ( e ) {
				// Propagate exception as error if not done
				if ( state < 2 ) {
					done( -1, e );
				// Simply rethrow otherwise
				} else {
					throw e;
				}
			}
		}

		// Callback for when everything is done
		function done( status, nativeStatusText, responses, headers ) {
			var isSuccess, success, error, response, modified,
				statusText = nativeStatusText;

			// Called once
			if ( state === 2 ) {
				return;
			}

			// State is "done" now
			state = 2;

			// Clear timeout if it exists
			if ( timeoutTimer ) {
				clearTimeout( timeoutTimer );
			}

			// Dereference transport for early garbage collection
			// (no matter how long the jqXHR object will be used)
			transport = undefined;

			// Cache response headers
			responseHeadersString = headers || "";

			// Set readyState
			jqXHR.readyState = status > 0 ? 4 : 0;

			// Get response data
			if ( responses ) {
				response = ajaxHandleResponses( s, jqXHR, responses );
			}

			// If successful, handle type chaining
			if ( status >= 200 && status < 300 || status === 304 ) {

				// Set the If-Modified-Since and/or If-None-Match header, if in ifModified mode.
				if ( s.ifModified ) {
					modified = jqXHR.getResponseHeader("Last-Modified");
					if ( modified ) {
						jQuery.lastModified[ cacheURL ] = modified;
					}
					modified = jqXHR.getResponseHeader("etag");
					if ( modified ) {
						jQuery.etag[ cacheURL ] = modified;
					}
				}

				// If not modified
				if ( status === 304 ) {
					isSuccess = true;
					statusText = "notmodified";

				// If we have data
				} else {
					isSuccess = ajaxConvert( s, response );
					statusText = isSuccess.state;
					success = isSuccess.data;
					error = isSuccess.error;
					isSuccess = !error;
				}
			} else {
				// We extract error from statusText
				// then normalize statusText and status for non-aborts
				error = statusText;
				if ( status || !statusText ) {
					statusText = "error";
					if ( status < 0 ) {
						status = 0;
					}
				}
			}

			// Set data for the fake xhr object
			jqXHR.status = status;
			jqXHR.statusText = ( nativeStatusText || statusText ) + "";

			// Success/Error
			if ( isSuccess ) {
				deferred.resolveWith( callbackContext, [ success, statusText, jqXHR ] );
			} else {
				deferred.rejectWith( callbackContext, [ jqXHR, statusText, error ] );
			}

			// Status-dependent callbacks
			jqXHR.statusCode( statusCode );
			statusCode = undefined;

			if ( fireGlobals ) {
				globalEventContext.trigger( isSuccess ? "ajaxSuccess" : "ajaxError",
					[ jqXHR, s, isSuccess ? success : error ] );
			}

			// Complete
			completeDeferred.fireWith( callbackContext, [ jqXHR, statusText ] );

			if ( fireGlobals ) {
				globalEventContext.trigger( "ajaxComplete", [ jqXHR, s ] );
				// Handle the global AJAX counter
				if ( !( --jQuery.active ) ) {
					jQuery.event.trigger("ajaxStop");
				}
			}
		}

		return jqXHR;
	},

	getScript: function( url, callback ) {
		return jQuery.get( url, undefined, callback, "script" );
	},

	getJSON: function( url, data, callback ) {
		return jQuery.get( url, data, callback, "json" );
	}
});

/* Handles responses to an ajax request:
 * - sets all responseXXX fields accordingly
 * - finds the right dataType (mediates between content-type and expected dataType)
 * - returns the corresponding response
 */
function ajaxHandleResponses( s, jqXHR, responses ) {

	var ct, type, finalDataType, firstDataType,
		contents = s.contents,
		dataTypes = s.dataTypes,
		responseFields = s.responseFields;

	// Fill responseXXX fields
	for ( type in responseFields ) {
		if ( type in responses ) {
			jqXHR[ responseFields[type] ] = responses[ type ];
		}
	}

	// Remove auto dataType and get content-type in the process
	while( dataTypes[ 0 ] === "*" ) {
		dataTypes.shift();
		if ( ct === undefined ) {
			ct = s.mimeType || jqXHR.getResponseHeader("Content-Type");
		}
	}

	// Check if we're dealing with a known content-type
	if ( ct ) {
		for ( type in contents ) {
			if ( contents[ type ] && contents[ type ].test( ct ) ) {
				dataTypes.unshift( type );
				break;
			}
		}
	}

	// Check to see if we have a response for the expected dataType
	if ( dataTypes[ 0 ] in responses ) {
		finalDataType = dataTypes[ 0 ];
	} else {
		// Try convertible dataTypes
		for ( type in responses ) {
			if ( !dataTypes[ 0 ] || s.converters[ type + " " + dataTypes[0] ] ) {
				finalDataType = type;
				break;
			}
			if ( !firstDataType ) {
				firstDataType = type;
			}
		}
		// Or just use first one
		finalDataType = finalDataType || firstDataType;
	}

	// If we found a dataType
	// We add the dataType to the list if needed
	// and return the corresponding response
	if ( finalDataType ) {
		if ( finalDataType !== dataTypes[ 0 ] ) {
			dataTypes.unshift( finalDataType );
		}
		return responses[ finalDataType ];
	}
}

// Chain conversions given the request and the original response
function ajaxConvert( s, response ) {

	var conv, conv2, current, tmp,
		converters = {},
		i = 0,
		// Work with a copy of dataTypes in case we need to modify it for conversion
		dataTypes = s.dataTypes.slice(),
		prev = dataTypes[ 0 ];

	// Apply the dataFilter if provided
	if ( s.dataFilter ) {
		response = s.dataFilter( response, s.dataType );
	}

	// Create converters map with lowercased keys
	if ( dataTypes[ 1 ] ) {
		for ( conv in s.converters ) {
			converters[ conv.toLowerCase() ] = s.converters[ conv ];
		}
	}

	// Convert to each sequential dataType, tolerating list modification
	for ( ; (current = dataTypes[++i]); ) {

		// There's only work to do if current dataType is non-auto
		if ( current !== "*" ) {

			// Convert response if prev dataType is non-auto and differs from current
			if ( prev !== "*" && prev !== current ) {

				// Seek a direct converter
				conv = converters[ prev + " " + current ] || converters[ "* " + current ];

				// If none found, seek a pair
				if ( !conv ) {
					for ( conv2 in converters ) {

						// If conv2 outputs current
						tmp = conv2.split(" ");
						if ( tmp[ 1 ] === current ) {

							// If prev can be converted to accepted input
							conv = converters[ prev + " " + tmp[ 0 ] ] ||
								converters[ "* " + tmp[ 0 ] ];
							if ( conv ) {
								// Condense equivalence converters
								if ( conv === true ) {
									conv = converters[ conv2 ];

								// Otherwise, insert the intermediate dataType
								} else if ( converters[ conv2 ] !== true ) {
									current = tmp[ 0 ];
									dataTypes.splice( i--, 0, current );
								}

								break;
							}
						}
					}
				}

				// Apply converter (if not an equivalence)
				if ( conv !== true ) {

					// Unless errors are allowed to bubble, catch and return them
					if ( conv && s["throws"] ) {
						response = conv( response );
					} else {
						try {
							response = conv( response );
						} catch ( e ) {
							return { state: "parsererror", error: conv ? e : "No conversion from " + prev + " to " + current };
						}
					}
				}
			}

			// Update prev for next iteration
			prev = current;
		}
	}

	return { state: "success", data: response };
}
// Install script dataType
jQuery.ajaxSetup({
	accepts: {
		script: "text/javascript, application/javascript, application/ecmascript, application/x-ecmascript"
	},
	contents: {
		script: /(?:java|ecma)script/
	},
	converters: {
		"text script": function( text ) {
			jQuery.globalEval( text );
			return text;
		}
	}
});

// Handle cache's special case and global
jQuery.ajaxPrefilter( "script", function( s ) {
	if ( s.cache === undefined ) {
		s.cache = false;
	}
	if ( s.crossDomain ) {
		s.type = "GET";
		s.global = false;
	}
});

// Bind script tag hack transport
jQuery.ajaxTransport( "script", function(s) {

	// This transport only deals with cross domain requests
	if ( s.crossDomain ) {

		var script,
			head = document.head || jQuery("head")[0] || document.documentElement;

		return {

			send: function( _, callback ) {

				script = document.createElement("script");

				script.async = true;

				if ( s.scriptCharset ) {
					script.charset = s.scriptCharset;
				}

				script.src = s.url;

				// Attach handlers for all browsers
				script.onload = script.onreadystatechange = function( _, isAbort ) {

					if ( isAbort || !script.readyState || /loaded|complete/.test( script.readyState ) ) {

						// Handle memory leak in IE
						script.onload = script.onreadystatechange = null;

						// Remove the script
						if ( script.parentNode ) {
							script.parentNode.removeChild( script );
						}

						// Dereference the script
						script = null;

						// Callback if not abort
						if ( !isAbort ) {
							callback( 200, "success" );
						}
					}
				};

				// Circumvent IE6 bugs with base elements (#2709 and #4378) by prepending
				// Use native DOM manipulation to avoid our domManip AJAX trickery
				head.insertBefore( script, head.firstChild );
			},

			abort: function() {
				if ( script ) {
					script.onload( undefined, true );
				}
			}
		};
	}
});
var oldCallbacks = [],
	rjsonp = /(=)\?(?=&|$)|\?\?/;

// Default jsonp settings
jQuery.ajaxSetup({
	jsonp: "callback",
	jsonpCallback: function() {
		var callback = oldCallbacks.pop() || ( jQuery.expando + "_" + ( ajax_nonce++ ) );
		this[ callback ] = true;
		return callback;
	}
});

// Detect, normalize options and install callbacks for jsonp requests
jQuery.ajaxPrefilter( "json jsonp", function( s, originalSettings, jqXHR ) {

	var callbackName, overwritten, responseContainer,
		jsonProp = s.jsonp !== false && ( rjsonp.test( s.url ) ?
			"url" :
			typeof s.data === "string" && !( s.contentType || "" ).indexOf("application/x-www-form-urlencoded") && rjsonp.test( s.data ) && "data"
		);

	// Handle iff the expected data type is "jsonp" or we have a parameter to set
	if ( jsonProp || s.dataTypes[ 0 ] === "jsonp" ) {

		// Get callback name, remembering preexisting value associated with it
		callbackName = s.jsonpCallback = jQuery.isFunction( s.jsonpCallback ) ?
			s.jsonpCallback() :
			s.jsonpCallback;

		// Insert callback into url or form data
		if ( jsonProp ) {
			s[ jsonProp ] = s[ jsonProp ].replace( rjsonp, "$1" + callbackName );
		} else if ( s.jsonp !== false ) {
			s.url += ( ajax_rquery.test( s.url ) ? "&" : "?" ) + s.jsonp + "=" + callbackName;
		}

		// Use data converter to retrieve json after script execution
		s.converters["script json"] = function() {
			if ( !responseContainer ) {
				jQuery.error( callbackName + " was not called" );
			}
			return responseContainer[ 0 ];
		};

		// force json dataType
		s.dataTypes[ 0 ] = "json";

		// Install callback
		overwritten = window[ callbackName ];
		window[ callbackName ] = function() {
			responseContainer = arguments;
		};

		// Clean-up function (fires after converters)
		jqXHR.always(function() {
			// Restore preexisting value
			window[ callbackName ] = overwritten;

			// Save back as free
			if ( s[ callbackName ] ) {
				// make sure that re-using the options doesn't screw things around
				s.jsonpCallback = originalSettings.jsonpCallback;

				// save the callback name for future use
				oldCallbacks.push( callbackName );
			}

			// Call if it was a function and we have a response
			if ( responseContainer && jQuery.isFunction( overwritten ) ) {
				overwritten( responseContainer[ 0 ] );
			}

			responseContainer = overwritten = undefined;
		});

		// Delegate to script
		return "script";
	}
});
var xhrCallbacks, xhrSupported,
	xhrId = 0,
	// #5280: Internet Explorer will keep connections alive if we don't abort on unload
	xhrOnUnloadAbort = window.ActiveXObject && function() {
		// Abort all pending requests
		var key;
		for ( key in xhrCallbacks ) {
			xhrCallbacks[ key ]( undefined, true );
		}
	};

// Functions to create xhrs
function createStandardXHR() {
	try {
		return new window.XMLHttpRequest();
	} catch( e ) {}
}

function createActiveXHR() {
	try {
		return new window.ActiveXObject("Microsoft.XMLHTTP");
	} catch( e ) {}
}

// Create the request object
// (This is still attached to ajaxSettings for backward compatibility)
jQuery.ajaxSettings.xhr = window.ActiveXObject ?
	/* Microsoft failed to properly
	 * implement the XMLHttpRequest in IE7 (can't request local files),
	 * so we use the ActiveXObject when it is available
	 * Additionally XMLHttpRequest can be disabled in IE7/IE8 so
	 * we need a fallback.
	 */
	function() {
		return !this.isLocal && createStandardXHR() || createActiveXHR();
	} :
	// For all other browsers, use the standard XMLHttpRequest object
	createStandardXHR;

// Determine support properties
xhrSupported = jQuery.ajaxSettings.xhr();
jQuery.support.cors = !!xhrSupported && ( "withCredentials" in xhrSupported );
xhrSupported = jQuery.support.ajax = !!xhrSupported;

// Create transport if the browser can provide an xhr
if ( xhrSupported ) {

	jQuery.ajaxTransport(function( s ) {
		// Cross domain only allowed if supported through XMLHttpRequest
		if ( !s.crossDomain || jQuery.support.cors ) {

			var callback;

			return {
				send: function( headers, complete ) {

					// Get a new xhr
					var handle, i,
						xhr = s.xhr();

					// Open the socket
					// Passing null username, generates a login popup on Opera (#2865)
					if ( s.username ) {
						xhr.open( s.type, s.url, s.async, s.username, s.password );
					} else {
						xhr.open( s.type, s.url, s.async );
					}

					// Apply custom fields if provided
					if ( s.xhrFields ) {
						for ( i in s.xhrFields ) {
							xhr[ i ] = s.xhrFields[ i ];
						}
					}

					// Override mime type if needed
					if ( s.mimeType && xhr.overrideMimeType ) {
						xhr.overrideMimeType( s.mimeType );
					}

					// X-Requested-With header
					// For cross-domain requests, seeing as conditions for a preflight are
					// akin to a jigsaw puzzle, we simply never set it to be sure.
					// (it can always be set on a per-request basis or even using ajaxSetup)
					// For same-domain requests, won't change header if already provided.
					if ( !s.crossDomain && !headers["X-Requested-With"] ) {
						headers["X-Requested-With"] = "XMLHttpRequest";
					}

					// Need an extra try/catch for cross domain requests in Firefox 3
					try {
						for ( i in headers ) {
							xhr.setRequestHeader( i, headers[ i ] );
						}
					} catch( err ) {}

					// Do send the request
					// This may raise an exception which is actually
					// handled in jQuery.ajax (so no try/catch here)
					xhr.send( ( s.hasContent && s.data ) || null );

					// Listener
					callback = function( _, isAbort ) {

						var status,
							statusText,
							responseHeaders,
							responses,
							xml;

						// Firefox throws exceptions when accessing properties
						// of an xhr when a network error occurred
						// http://helpful.knobs-dials.com/index.php/Component_returned_failure_code:_0x80040111_(NS_ERROR_NOT_AVAILABLE)
						try {

							// Was never called and is aborted or complete
							if ( callback && ( isAbort || xhr.readyState === 4 ) ) {

								// Only called once
								callback = undefined;

								// Do not keep as active anymore
								if ( handle ) {
									xhr.onreadystatechange = jQuery.noop;
									if ( xhrOnUnloadAbort ) {
										delete xhrCallbacks[ handle ];
									}
								}

								// If it's an abort
								if ( isAbort ) {
									// Abort it manually if needed
									if ( xhr.readyState !== 4 ) {
										xhr.abort();
									}
								} else {
									responses = {};
									status = xhr.status;
									xml = xhr.responseXML;
									responseHeaders = xhr.getAllResponseHeaders();

									// Construct response list
									if ( xml && xml.documentElement /* #4958 */ ) {
										responses.xml = xml;
									}

									// When requesting binary data, IE6-9 will throw an exception
									// on any attempt to access responseText (#11426)
									if ( typeof xhr.responseText === "string" ) {
										responses.text = xhr.responseText;
									}

									// Firefox throws an exception when accessing
									// statusText for faulty cross-domain requests
									try {
										statusText = xhr.statusText;
									} catch( e ) {
										// We normalize with Webkit giving an empty statusText
										statusText = "";
									}

									// Filter status for non standard behaviors

									// If the request is local and we have data: assume a success
									// (success with no data won't get notified, that's the best we
									// can do given current implementations)
									if ( !status && s.isLocal && !s.crossDomain ) {
										status = responses.text ? 200 : 404;
									// IE - #1450: sometimes returns 1223 when it should be 204
									} else if ( status === 1223 ) {
										status = 204;
									}
								}
							}
						} catch( firefoxAccessException ) {
							if ( !isAbort ) {
								complete( -1, firefoxAccessException );
							}
						}

						// Call complete if needed
						if ( responses ) {
							complete( status, statusText, responses, responseHeaders );
						}
					};

					if ( !s.async ) {
						// if we're in sync mode we fire the callback
						callback();
					} else if ( xhr.readyState === 4 ) {
						// (IE6 & IE7) if it's in cache and has been
						// retrieved directly we need to fire the callback
						setTimeout( callback );
					} else {
						handle = ++xhrId;
						if ( xhrOnUnloadAbort ) {
							// Create the active xhrs callbacks list if needed
							// and attach the unload handler
							if ( !xhrCallbacks ) {
								xhrCallbacks = {};
								jQuery( window ).unload( xhrOnUnloadAbort );
							}
							// Add to list of active xhrs callbacks
							xhrCallbacks[ handle ] = callback;
						}
						xhr.onreadystatechange = callback;
					}
				},

				abort: function() {
					if ( callback ) {
						callback( undefined, true );
					}
				}
			};
		}
	});
}
var fxNow, timerId,
	rfxtypes = /^(?:toggle|show|hide)$/,
	rfxnum = new RegExp( "^(?:([+-])=|)(" + core_pnum + ")([a-z%]*)$", "i" ),
	rrun = /queueHooks$/,
	animationPrefilters = [ defaultPrefilter ],
	tweeners = {
		"*": [function( prop, value ) {
			var end, unit,
				tween = this.createTween( prop, value ),
				parts = rfxnum.exec( value ),
				target = tween.cur(),
				start = +target || 0,
				scale = 1,
				maxIterations = 20;

			if ( parts ) {
				end = +parts[2];
				unit = parts[3] || ( jQuery.cssNumber[ prop ] ? "" : "px" );

				// We need to compute starting value
				if ( unit !== "px" && start ) {
					// Iteratively approximate from a nonzero starting point
					// Prefer the current property, because this process will be trivial if it uses the same units
					// Fallback to end or a simple constant
					start = jQuery.css( tween.elem, prop, true ) || end || 1;

					do {
						// If previous iteration zeroed out, double until we get *something*
						// Use a string for doubling factor so we don't accidentally see scale as unchanged below
						scale = scale || ".5";

						// Adjust and apply
						start = start / scale;
						jQuery.style( tween.elem, prop, start + unit );

					// Update scale, tolerating zero or NaN from tween.cur()
					// And breaking the loop if scale is unchanged or perfect, or if we've just had enough
					} while ( scale !== (scale = tween.cur() / target) && scale !== 1 && --maxIterations );
				}

				tween.unit = unit;
				tween.start = start;
				// If a +=/-= token was provided, we're doing a relative animation
				tween.end = parts[1] ? start + ( parts[1] + 1 ) * end : end;
			}
			return tween;
		}]
	};

// Animations created synchronously will run synchronously
function createFxNow() {
	setTimeout(function() {
		fxNow = undefined;
	});
	return ( fxNow = jQuery.now() );
}

function createTweens( animation, props ) {
	jQuery.each( props, function( prop, value ) {
		var collection = ( tweeners[ prop ] || [] ).concat( tweeners[ "*" ] ),
			index = 0,
			length = collection.length;
		for ( ; index < length; index++ ) {
			if ( collection[ index ].call( animation, prop, value ) ) {

				// we're done with this property
				return;
			}
		}
	});
}

function Animation( elem, properties, options ) {
	var result,
		stopped,
		index = 0,
		length = animationPrefilters.length,
		deferred = jQuery.Deferred().always( function() {
			// don't match elem in the :animated selector
			delete tick.elem;
		}),
		tick = function() {
			if ( stopped ) {
				return false;
			}
			var currentTime = fxNow || createFxNow(),
				remaining = Math.max( 0, animation.startTime + animation.duration - currentTime ),
				// archaic crash bug won't allow us to use 1 - ( 0.5 || 0 ) (#12497)
				temp = remaining / animation.duration || 0,
				percent = 1 - temp,
				index = 0,
				length = animation.tweens.length;

			for ( ; index < length ; index++ ) {
				animation.tweens[ index ].run( percent );
			}

			deferred.notifyWith( elem, [ animation, percent, remaining ]);

			if ( percent < 1 && length ) {
				return remaining;
			} else {
				deferred.resolveWith( elem, [ animation ] );
				return false;
			}
		},
		animation = deferred.promise({
			elem: elem,
			props: jQuery.extend( {}, properties ),
			opts: jQuery.extend( true, { specialEasing: {} }, options ),
			originalProperties: properties,
			originalOptions: options,
			startTime: fxNow || createFxNow(),
			duration: options.duration,
			tweens: [],
			createTween: function( prop, end ) {
				var tween = jQuery.Tween( elem, animation.opts, prop, end,
						animation.opts.specialEasing[ prop ] || animation.opts.easing );
				animation.tweens.push( tween );
				return tween;
			},
			stop: function( gotoEnd ) {
				var index = 0,
					// if we are going to the end, we want to run all the tweens
					// otherwise we skip this part
					length = gotoEnd ? animation.tweens.length : 0;
				if ( stopped ) {
					return this;
				}
				stopped = true;
				for ( ; index < length ; index++ ) {
					animation.tweens[ index ].run( 1 );
				}

				// resolve when we played the last frame
				// otherwise, reject
				if ( gotoEnd ) {
					deferred.resolveWith( elem, [ animation, gotoEnd ] );
				} else {
					deferred.rejectWith( elem, [ animation, gotoEnd ] );
				}
				return this;
			}
		}),
		props = animation.props;

	propFilter( props, animation.opts.specialEasing );

	for ( ; index < length ; index++ ) {
		result = animationPrefilters[ index ].call( animation, elem, props, animation.opts );
		if ( result ) {
			return result;
		}
	}

	createTweens( animation, props );

	if ( jQuery.isFunction( animation.opts.start ) ) {
		animation.opts.start.call( elem, animation );
	}

	jQuery.fx.timer(
		jQuery.extend( tick, {
			elem: elem,
			anim: animation,
			queue: animation.opts.queue
		})
	);

	// attach callbacks from options
	return animation.progress( animation.opts.progress )
		.done( animation.opts.done, animation.opts.complete )
		.fail( animation.opts.fail )
		.always( animation.opts.always );
}

function propFilter( props, specialEasing ) {
	var index, name, easing, value, hooks;

	// camelCase, specialEasing and expand cssHook pass
	for ( index in props ) {
		name = jQuery.camelCase( index );
		easing = specialEasing[ name ];
		value = props[ index ];
		if ( jQuery.isArray( value ) ) {
			easing = value[ 1 ];
			value = props[ index ] = value[ 0 ];
		}

		if ( index !== name ) {
			props[ name ] = value;
			delete props[ index ];
		}

		hooks = jQuery.cssHooks[ name ];
		if ( hooks && "expand" in hooks ) {
			value = hooks.expand( value );
			delete props[ name ];

			// not quite $.extend, this wont overwrite keys already present.
			// also - reusing 'index' from above because we have the correct "name"
			for ( index in value ) {
				if ( !( index in props ) ) {
					props[ index ] = value[ index ];
					specialEasing[ index ] = easing;
				}
			}
		} else {
			specialEasing[ name ] = easing;
		}
	}
}

jQuery.Animation = jQuery.extend( Animation, {

	tweener: function( props, callback ) {
		if ( jQuery.isFunction( props ) ) {
			callback = props;
			props = [ "*" ];
		} else {
			props = props.split(" ");
		}

		var prop,
			index = 0,
			length = props.length;

		for ( ; index < length ; index++ ) {
			prop = props[ index ];
			tweeners[ prop ] = tweeners[ prop ] || [];
			tweeners[ prop ].unshift( callback );
		}
	},

	prefilter: function( callback, prepend ) {
		if ( prepend ) {
			animationPrefilters.unshift( callback );
		} else {
			animationPrefilters.push( callback );
		}
	}
});

function defaultPrefilter( elem, props, opts ) {
	/*jshint validthis:true */
	var index, prop, value, length, dataShow, toggle, tween, hooks, oldfire,
		anim = this,
		style = elem.style,
		orig = {},
		handled = [],
		hidden = elem.nodeType && isHidden( elem );

	// handle queue: false promises
	if ( !opts.queue ) {
		hooks = jQuery._queueHooks( elem, "fx" );
		if ( hooks.unqueued == null ) {
			hooks.unqueued = 0;
			oldfire = hooks.empty.fire;
			hooks.empty.fire = function() {
				if ( !hooks.unqueued ) {
					oldfire();
				}
			};
		}
		hooks.unqueued++;

		anim.always(function() {
			// doing this makes sure that the complete handler will be called
			// before this completes
			anim.always(function() {
				hooks.unqueued--;
				if ( !jQuery.queue( elem, "fx" ).length ) {
					hooks.empty.fire();
				}
			});
		});
	}

	// height/width overflow pass
	if ( elem.nodeType === 1 && ( "height" in props || "width" in props ) ) {
		// Make sure that nothing sneaks out
		// Record all 3 overflow attributes because IE does not
		// change the overflow attribute when overflowX and
		// overflowY are set to the same value
		opts.overflow = [ style.overflow, style.overflowX, style.overflowY ];

		// Set display property to inline-block for height/width
		// animations on inline elements that are having width/height animated
		if ( jQuery.css( elem, "display" ) === "inline" &&
				jQuery.css( elem, "float" ) === "none" ) {

			// inline-level elements accept inline-block;
			// block-level elements need to be inline with layout
			if ( !jQuery.support.inlineBlockNeedsLayout || css_defaultDisplay( elem.nodeName ) === "inline" ) {
				style.display = "inline-block";

			} else {
				style.zoom = 1;
			}
		}
	}

	if ( opts.overflow ) {
		style.overflow = "hidden";
		if ( !jQuery.support.shrinkWrapBlocks ) {
			anim.done(function() {
				style.overflow = opts.overflow[ 0 ];
				style.overflowX = opts.overflow[ 1 ];
				style.overflowY = opts.overflow[ 2 ];
			});
		}
	}


	// show/hide pass
	for ( index in props ) {
		value = props[ index ];
		if ( rfxtypes.exec( value ) ) {
			delete props[ index ];
			toggle = toggle || value === "toggle";
			if ( value === ( hidden ? "hide" : "show" ) ) {
				continue;
			}
			handled.push( index );
		}
	}

	length = handled.length;
	if ( length ) {
		dataShow = jQuery._data( elem, "fxshow" ) || jQuery._data( elem, "fxshow", {} );
		if ( "hidden" in dataShow ) {
			hidden = dataShow.hidden;
		}

		// store state if its toggle - enables .stop().toggle() to "reverse"
		if ( toggle ) {
			dataShow.hidden = !hidden;
		}
		if ( hidden ) {
			jQuery( elem ).show();
		} else {
			anim.done(function() {
				jQuery( elem ).hide();
			});
		}
		anim.done(function() {
			var prop;
			jQuery._removeData( elem, "fxshow" );
			for ( prop in orig ) {
				jQuery.style( elem, prop, orig[ prop ] );
			}
		});
		for ( index = 0 ; index < length ; index++ ) {
			prop = handled[ index ];
			tween = anim.createTween( prop, hidden ? dataShow[ prop ] : 0 );
			orig[ prop ] = dataShow[ prop ] || jQuery.style( elem, prop );

			if ( !( prop in dataShow ) ) {
				dataShow[ prop ] = tween.start;
				if ( hidden ) {
					tween.end = tween.start;
					tween.start = prop === "width" || prop === "height" ? 1 : 0;
				}
			}
		}
	}
}

function Tween( elem, options, prop, end, easing ) {
	return new Tween.prototype.init( elem, options, prop, end, easing );
}
jQuery.Tween = Tween;

Tween.prototype = {
	constructor: Tween,
	init: function( elem, options, prop, end, easing, unit ) {
		this.elem = elem;
		this.prop = prop;
		this.easing = easing || "swing";
		this.options = options;
		this.start = this.now = this.cur();
		this.end = end;
		this.unit = unit || ( jQuery.cssNumber[ prop ] ? "" : "px" );
	},
	cur: function() {
		var hooks = Tween.propHooks[ this.prop ];

		return hooks && hooks.get ?
			hooks.get( this ) :
			Tween.propHooks._default.get( this );
	},
	run: function( percent ) {
		var eased,
			hooks = Tween.propHooks[ this.prop ];

		if ( this.options.duration ) {
			this.pos = eased = jQuery.easing[ this.easing ](
				percent, this.options.duration * percent, 0, 1, this.options.duration
			);
		} else {
			this.pos = eased = percent;
		}
		this.now = ( this.end - this.start ) * eased + this.start;

		if ( this.options.step ) {
			this.options.step.call( this.elem, this.now, this );
		}

		if ( hooks && hooks.set ) {
			hooks.set( this );
		} else {
			Tween.propHooks._default.set( this );
		}
		return this;
	}
};

Tween.prototype.init.prototype = Tween.prototype;

Tween.propHooks = {
	_default: {
		get: function( tween ) {
			var result;

			if ( tween.elem[ tween.prop ] != null &&
				(!tween.elem.style || tween.elem.style[ tween.prop ] == null) ) {
				return tween.elem[ tween.prop ];
			}

			// passing a non empty string as a 3rd parameter to .css will automatically
			// attempt a parseFloat and fallback to a string if the parse fails
			// so, simple values such as "10px" are parsed to Float.
			// complex values such as "rotate(1rad)" are returned as is.
			result = jQuery.css( tween.elem, tween.prop, "auto" );
			// Empty strings, null, undefined and "auto" are converted to 0.
			return !result || result === "auto" ? 0 : result;
		},
		set: function( tween ) {
			// use step hook for back compat - use cssHook if its there - use .style if its
			// available and use plain properties where available
			if ( jQuery.fx.step[ tween.prop ] ) {
				jQuery.fx.step[ tween.prop ]( tween );
			} else if ( tween.elem.style && ( tween.elem.style[ jQuery.cssProps[ tween.prop ] ] != null || jQuery.cssHooks[ tween.prop ] ) ) {
				jQuery.style( tween.elem, tween.prop, tween.now + tween.unit );
			} else {
				tween.elem[ tween.prop ] = tween.now;
			}
		}
	}
};

// Remove in 2.0 - this supports IE8's panic based approach
// to setting things on disconnected nodes

Tween.propHooks.scrollTop = Tween.propHooks.scrollLeft = {
	set: function( tween ) {
		if ( tween.elem.nodeType && tween.elem.parentNode ) {
			tween.elem[ tween.prop ] = tween.now;
		}
	}
};

jQuery.each([ "toggle", "show", "hide" ], function( i, name ) {
	var cssFn = jQuery.fn[ name ];
	jQuery.fn[ name ] = function( speed, easing, callback ) {
		return speed == null || typeof speed === "boolean" ?
			cssFn.apply( this, arguments ) :
			this.animate( genFx( name, true ), speed, easing, callback );
	};
});

jQuery.fn.extend({
	fadeTo: function( speed, to, easing, callback ) {

		// show any hidden elements after setting opacity to 0
		return this.filter( isHidden ).css( "opacity", 0 ).show()

			// animate to the value specified
			.end().animate({ opacity: to }, speed, easing, callback );
	},
	animate: function( prop, speed, easing, callback ) {
		var empty = jQuery.isEmptyObject( prop ),
			optall = jQuery.speed( speed, easing, callback ),
			doAnimation = function() {
				// Operate on a copy of prop so per-property easing won't be lost
				var anim = Animation( this, jQuery.extend( {}, prop ), optall );
				doAnimation.finish = function() {
					anim.stop( true );
				};
				// Empty animations, or finishing resolves immediately
				if ( empty || jQuery._data( this, "finish" ) ) {
					anim.stop( true );
				}
			};
			doAnimation.finish = doAnimation;

		return empty || optall.queue === false ?
			this.each( doAnimation ) :
			this.queue( optall.queue, doAnimation );
	},
	stop: function( type, clearQueue, gotoEnd ) {
		var stopQueue = function( hooks ) {
			var stop = hooks.stop;
			delete hooks.stop;
			stop( gotoEnd );
		};

		if ( typeof type !== "string" ) {
			gotoEnd = clearQueue;
			clearQueue = type;
			type = undefined;
		}
		if ( clearQueue && type !== false ) {
			this.queue( type || "fx", [] );
		}

		return this.each(function() {
			var dequeue = true,
				index = type != null && type + "queueHooks",
				timers = jQuery.timers,
				data = jQuery._data( this );

			if ( index ) {
				if ( data[ index ] && data[ index ].stop ) {
					stopQueue( data[ index ] );
				}
			} else {
				for ( index in data ) {
					if ( data[ index ] && data[ index ].stop && rrun.test( index ) ) {
						stopQueue( data[ index ] );
					}
				}
			}

			for ( index = timers.length; index--; ) {
				if ( timers[ index ].elem === this && (type == null || timers[ index ].queue === type) ) {
					timers[ index ].anim.stop( gotoEnd );
					dequeue = false;
					timers.splice( index, 1 );
				}
			}

			// start the next in the queue if the last step wasn't forced
			// timers currently will call their complete callbacks, which will dequeue
			// but only if they were gotoEnd
			if ( dequeue || !gotoEnd ) {
				jQuery.dequeue( this, type );
			}
		});
	},
	finish: function( type ) {
		if ( type !== false ) {
			type = type || "fx";
		}
		return this.each(function() {
			var index,
				data = jQuery._data( this ),
				queue = data[ type + "queue" ],
				hooks = data[ type + "queueHooks" ],
				timers = jQuery.timers,
				length = queue ? queue.length : 0;

			// enable finishing flag on private data
			data.finish = true;

			// empty the queue first
			jQuery.queue( this, type, [] );

			if ( hooks && hooks.cur && hooks.cur.finish ) {
				hooks.cur.finish.call( this );
			}

			// look for any active animations, and finish them
			for ( index = timers.length; index--; ) {
				if ( timers[ index ].elem === this && timers[ index ].queue === type ) {
					timers[ index ].anim.stop( true );
					timers.splice( index, 1 );
				}
			}

			// look for any animations in the old queue and finish them
			for ( index = 0; index < length; index++ ) {
				if ( queue[ index ] && queue[ index ].finish ) {
					queue[ index ].finish.call( this );
				}
			}

			// turn off finishing flag
			delete data.finish;
		});
	}
});

// Generate parameters to create a standard animation
function genFx( type, includeWidth ) {
	var which,
		attrs = { height: type },
		i = 0;

	// if we include width, step value is 1 to do all cssExpand values,
	// if we don't include width, step value is 2 to skip over Left and Right
	includeWidth = includeWidth? 1 : 0;
	for( ; i < 4 ; i += 2 - includeWidth ) {
		which = cssExpand[ i ];
		attrs[ "margin" + which ] = attrs[ "padding" + which ] = type;
	}

	if ( includeWidth ) {
		attrs.opacity = attrs.width = type;
	}

	return attrs;
}

// Generate shortcuts for custom animations
jQuery.each({
	slideDown: genFx("show"),
	slideUp: genFx("hide"),
	slideToggle: genFx("toggle"),
	fadeIn: { opacity: "show" },
	fadeOut: { opacity: "hide" },
	fadeToggle: { opacity: "toggle" }
}, function( name, props ) {
	jQuery.fn[ name ] = function( speed, easing, callback ) {
		return this.animate( props, speed, easing, callback );
	};
});

jQuery.speed = function( speed, easing, fn ) {
	var opt = speed && typeof speed === "object" ? jQuery.extend( {}, speed ) : {
		complete: fn || !fn && easing ||
			jQuery.isFunction( speed ) && speed,
		duration: speed,
		easing: fn && easing || easing && !jQuery.isFunction( easing ) && easing
	};

	opt.duration = jQuery.fx.off ? 0 : typeof opt.duration === "number" ? opt.duration :
		opt.duration in jQuery.fx.speeds ? jQuery.fx.speeds[ opt.duration ] : jQuery.fx.speeds._default;

	// normalize opt.queue - true/undefined/null -> "fx"
	if ( opt.queue == null || opt.queue === true ) {
		opt.queue = "fx";
	}

	// Queueing
	opt.old = opt.complete;

	opt.complete = function() {
		if ( jQuery.isFunction( opt.old ) ) {
			opt.old.call( this );
		}

		if ( opt.queue ) {
			jQuery.dequeue( this, opt.queue );
		}
	};

	return opt;
};

jQuery.easing = {
	linear: function( p ) {
		return p;
	},
	swing: function( p ) {
		return 0.5 - Math.cos( p*Math.PI ) / 2;
	}
};

jQuery.timers = [];
jQuery.fx = Tween.prototype.init;
jQuery.fx.tick = function() {
	var timer,
		timers = jQuery.timers,
		i = 0;

	fxNow = jQuery.now();

	for ( ; i < timers.length; i++ ) {
		timer = timers[ i ];
		// Checks the timer has not already been removed
		if ( !timer() && timers[ i ] === timer ) {
			timers.splice( i--, 1 );
		}
	}

	if ( !timers.length ) {
		jQuery.fx.stop();
	}
	fxNow = undefined;
};

jQuery.fx.timer = function( timer ) {
	if ( timer() && jQuery.timers.push( timer ) ) {
		jQuery.fx.start();
	}
};

jQuery.fx.interval = 13;

jQuery.fx.start = function() {
	if ( !timerId ) {
		timerId = setInterval( jQuery.fx.tick, jQuery.fx.interval );
	}
};

jQuery.fx.stop = function() {
	clearInterval( timerId );
	timerId = null;
};

jQuery.fx.speeds = {
	slow: 600,
	fast: 200,
	// Default speed
	_default: 400
};

// Back Compat <1.8 extension point
jQuery.fx.step = {};

if ( jQuery.expr && jQuery.expr.filters ) {
	jQuery.expr.filters.animated = function( elem ) {
		return jQuery.grep(jQuery.timers, function( fn ) {
			return elem === fn.elem;
		}).length;
	};
}
jQuery.fn.offset = function( options ) {
	if ( arguments.length ) {
		return options === undefined ?
			this :
			this.each(function( i ) {
				jQuery.offset.setOffset( this, options, i );
			});
	}

	var docElem, win,
		box = { top: 0, left: 0 },
		elem = this[ 0 ],
		doc = elem && elem.ownerDocument;

	if ( !doc ) {
		return;
	}

	docElem = doc.documentElement;

	// Make sure it's not a disconnected DOM node
	if ( !jQuery.contains( docElem, elem ) ) {
		return box;
	}

	// If we don't have gBCR, just use 0,0 rather than error
	// BlackBerry 5, iOS 3 (original iPhone)
	if ( typeof elem.getBoundingClientRect !== "undefined" ) {
		box = elem.getBoundingClientRect();
	}
	win = getWindow( doc );
	return {
		top: box.top  + ( win.pageYOffset || docElem.scrollTop )  - ( docElem.clientTop  || 0 ),
		left: box.left + ( win.pageXOffset || docElem.scrollLeft ) - ( docElem.clientLeft || 0 )
	};
};

jQuery.offset = {

	setOffset: function( elem, options, i ) {
		var position = jQuery.css( elem, "position" );

		// set position first, in-case top/left are set even on static elem
		if ( position === "static" ) {
			elem.style.position = "relative";
		}

		var curElem = jQuery( elem ),
			curOffset = curElem.offset(),
			curCSSTop = jQuery.css( elem, "top" ),
			curCSSLeft = jQuery.css( elem, "left" ),
			calculatePosition = ( position === "absolute" || position === "fixed" ) && jQuery.inArray("auto", [curCSSTop, curCSSLeft]) > -1,
			props = {}, curPosition = {}, curTop, curLeft;

		// need to be able to calculate position if either top or left is auto and position is either absolute or fixed
		if ( calculatePosition ) {
			curPosition = curElem.position();
			curTop = curPosition.top;
			curLeft = curPosition.left;
		} else {
			curTop = parseFloat( curCSSTop ) || 0;
			curLeft = parseFloat( curCSSLeft ) || 0;
		}

		if ( jQuery.isFunction( options ) ) {
			options = options.call( elem, i, curOffset );
		}

		if ( options.top != null ) {
			props.top = ( options.top - curOffset.top ) + curTop;
		}
		if ( options.left != null ) {
			props.left = ( options.left - curOffset.left ) + curLeft;
		}

		if ( "using" in options ) {
			options.using.call( elem, props );
		} else {
			curElem.css( props );
		}
	}
};


jQuery.fn.extend({

	position: function() {
		if ( !this[ 0 ] ) {
			return;
		}

		var offsetParent, offset,
			parentOffset = { top: 0, left: 0 },
			elem = this[ 0 ];

		// fixed elements are offset from window (parentOffset = {top:0, left: 0}, because it is it's only offset parent
		if ( jQuery.css( elem, "position" ) === "fixed" ) {
			// we assume that getBoundingClientRect is available when computed position is fixed
			offset = elem.getBoundingClientRect();
		} else {
			// Get *real* offsetParent
			offsetParent = this.offsetParent();

			// Get correct offsets
			offset = this.offset();
			if ( !jQuery.nodeName( offsetParent[ 0 ], "html" ) ) {
				parentOffset = offsetParent.offset();
			}

			// Add offsetParent borders
			parentOffset.top  += jQuery.css( offsetParent[ 0 ], "borderTopWidth", true );
			parentOffset.left += jQuery.css( offsetParent[ 0 ], "borderLeftWidth", true );
		}

		// Subtract parent offsets and element margins
		// note: when an element has margin: auto the offsetLeft and marginLeft
		// are the same in Safari causing offset.left to incorrectly be 0
		return {
			top:  offset.top  - parentOffset.top - jQuery.css( elem, "marginTop", true ),
			left: offset.left - parentOffset.left - jQuery.css( elem, "marginLeft", true)
		};
	},

	offsetParent: function() {
		return this.map(function() {
			var offsetParent = this.offsetParent || document.documentElement;
			while ( offsetParent && ( !jQuery.nodeName( offsetParent, "html" ) && jQuery.css( offsetParent, "position") === "static" ) ) {
				offsetParent = offsetParent.offsetParent;
			}
			return offsetParent || document.documentElement;
		});
	}
});


// Create scrollLeft and scrollTop methods
jQuery.each( {scrollLeft: "pageXOffset", scrollTop: "pageYOffset"}, function( method, prop ) {
	var top = /Y/.test( prop );

	jQuery.fn[ method ] = function( val ) {
		return jQuery.access( this, function( elem, method, val ) {
			var win = getWindow( elem );

			if ( val === undefined ) {
				return win ? (prop in win) ? win[ prop ] :
					win.document.documentElement[ method ] :
					elem[ method ];
			}

			if ( win ) {
				win.scrollTo(
					!top ? val : jQuery( win ).scrollLeft(),
					top ? val : jQuery( win ).scrollTop()
				);

			} else {
				elem[ method ] = val;
			}
		}, method, val, arguments.length, null );
	};
});

function getWindow( elem ) {
	return jQuery.isWindow( elem ) ?
		elem :
		elem.nodeType === 9 ?
			elem.defaultView || elem.parentWindow :
			false;
}
// Create innerHeight, innerWidth, height, width, outerHeight and outerWidth methods
jQuery.each( { Height: "height", Width: "width" }, function( name, type ) {
	jQuery.each( { padding: "inner" + name, content: type, "": "outer" + name }, function( defaultExtra, funcName ) {
		// margin is only for outerHeight, outerWidth
		jQuery.fn[ funcName ] = function( margin, value ) {
			var chainable = arguments.length && ( defaultExtra || typeof margin !== "boolean" ),
				extra = defaultExtra || ( margin === true || value === true ? "margin" : "border" );

			return jQuery.access( this, function( elem, type, value ) {
				var doc;

				if ( jQuery.isWindow( elem ) ) {
					// As of 5/8/2012 this will yield incorrect results for Mobile Safari, but there
					// isn't a whole lot we can do. See pull request at this URL for discussion:
					// https://github.com/jquery/jquery/pull/764
					return elem.document.documentElement[ "client" + name ];
				}

				// Get document width or height
				if ( elem.nodeType === 9 ) {
					doc = elem.documentElement;

					// Either scroll[Width/Height] or offset[Width/Height] or client[Width/Height], whichever is greatest
					// unfortunately, this causes bug #3838 in IE6/8 only, but there is currently no good, small way to fix it.
					return Math.max(
						elem.body[ "scroll" + name ], doc[ "scroll" + name ],
						elem.body[ "offset" + name ], doc[ "offset" + name ],
						doc[ "client" + name ]
					);
				}

				return value === undefined ?
					// Get width or height on the element, requesting but not forcing parseFloat
					jQuery.css( elem, type, extra ) :

					// Set width or height on the element
					jQuery.style( elem, type, value, extra );
			}, type, chainable ? margin : undefined, chainable, null );
		};
	});
});
// Limit scope pollution from any deprecated API
// (function() {

// })();
// Expose jQuery to the global object
window.jQuery = window.$ = jQuery;

// Expose jQuery as an AMD module, but only for AMD loaders that
// understand the issues with loading multiple versions of jQuery
// in a page that all might call define(). The loader will indicate
// they have special allowances for multiple jQuery versions by
// specifying define.amd.jQuery = true. Register as a named module,
// since jQuery can be concatenated with other files that may use define,
// but not use a proper concatenation script that understands anonymous
// AMD modules. A named AMD is safest and most robust way to register.
// Lowercase jquery is used because AMD module names are derived from
// file names, and jQuery is normally delivered in a lowercase file name.
// Do this after creating the global so that if an AMD module wants to call
// noConflict to hide this version of jQuery, it will work.
if ( typeof define === "function" && define.amd && define.amd.jQuery ) {
	define( "jquery", [], function () { return jQuery; } );
}

})( window );

//     Underscore.js 1.6.0
//     http://underscorejs.org
//     (c) 2009-2014 Jeremy Ashkenas, DocumentCloud and Investigative Reporters & Editors
//     Underscore may be freely distributed under the MIT license.

(function() {

  // Baseline setup
  // --------------

  // Establish the root object, `window` in the browser, or `exports` on the server.
  var root = this;

  // Save the previous value of the `_` variable.
  var previousUnderscore = root._;

  // Establish the object that gets returned to break out of a loop iteration.
  var breaker = {};

  // Save bytes in the minified (but not gzipped) version:
  var ArrayProto = Array.prototype, ObjProto = Object.prototype, FuncProto = Function.prototype;

  // Create quick reference variables for speed access to core prototypes.
  var
    push             = ArrayProto.push,
    slice            = ArrayProto.slice,
    concat           = ArrayProto.concat,
    toString         = ObjProto.toString,
    hasOwnProperty   = ObjProto.hasOwnProperty;

  // All **ECMAScript 5** native function implementations that we hope to use
  // are declared here.
  var
    nativeForEach      = ArrayProto.forEach,
    nativeMap          = ArrayProto.map,
    nativeReduce       = ArrayProto.reduce,
    nativeReduceRight  = ArrayProto.reduceRight,
    nativeFilter       = ArrayProto.filter,
    nativeEvery        = ArrayProto.every,
    nativeSome         = ArrayProto.some,
    nativeIndexOf      = ArrayProto.indexOf,
    nativeLastIndexOf  = ArrayProto.lastIndexOf,
    nativeIsArray      = Array.isArray,
    nativeKeys         = Object.keys,
    nativeBind         = FuncProto.bind;

  // Create a safe reference to the Underscore object for use below.
  var _ = function(obj) {
    if (obj instanceof _) return obj;
    if (!(this instanceof _)) return new _(obj);
    this._wrapped = obj;
  };

  // Export the Underscore object for **Node.js**, with
  // backwards-compatibility for the old `require()` API. If we're in
  // the browser, add `_` as a global object via a string identifier,
  // for Closure Compiler "advanced" mode.
  if (typeof exports !== 'undefined') {
    if (typeof module !== 'undefined' && module.exports) {
      exports = module.exports = _;
    }
    exports._ = _;
  } else {
    root._ = _;
  }

  // Current version.
  _.VERSION = '1.6.0';

  // Collection Functions
  // --------------------

  // The cornerstone, an `each` implementation, aka `forEach`.
  // Handles objects with the built-in `forEach`, arrays, and raw objects.
  // Delegates to **ECMAScript 5**'s native `forEach` if available.
  var each = _.each = _.forEach = function(obj, iterator, context) {
    if (obj == null) return obj;
    if (nativeForEach && obj.forEach === nativeForEach) {
      obj.forEach(iterator, context);
    } else if (obj.length === +obj.length) {
      for (var i = 0, length = obj.length; i < length; i++) {
        if (iterator.call(context, obj[i], i, obj) === breaker) return;
      }
    } else {
      var keys = _.keys(obj);
      for (var i = 0, length = keys.length; i < length; i++) {
        if (iterator.call(context, obj[keys[i]], keys[i], obj) === breaker) return;
      }
    }
    return obj;
  };

  // Return the results of applying the iterator to each element.
  // Delegates to **ECMAScript 5**'s native `map` if available.
  _.map = _.collect = function(obj, iterator, context) {
    var results = [];
    if (obj == null) return results;
    if (nativeMap && obj.map === nativeMap) return obj.map(iterator, context);
    each(obj, function(value, index, list) {
      results.push(iterator.call(context, value, index, list));
    });
    return results;
  };

  var reduceError = 'Reduce of empty array with no initial value';

  // **Reduce** builds up a single result from a list of values, aka `inject`,
  // or `foldl`. Delegates to **ECMAScript 5**'s native `reduce` if available.
  _.reduce = _.foldl = _.inject = function(obj, iterator, memo, context) {
    var initial = arguments.length > 2;
    if (obj == null) obj = [];
    if (nativeReduce && obj.reduce === nativeReduce) {
      if (context) iterator = _.bind(iterator, context);
      return initial ? obj.reduce(iterator, memo) : obj.reduce(iterator);
    }
    each(obj, function(value, index, list) {
      if (!initial) {
        memo = value;
        initial = true;
      } else {
        memo = iterator.call(context, memo, value, index, list);
      }
    });
    if (!initial) throw new TypeError(reduceError);
    return memo;
  };

  // The right-associative version of reduce, also known as `foldr`.
  // Delegates to **ECMAScript 5**'s native `reduceRight` if available.
  _.reduceRight = _.foldr = function(obj, iterator, memo, context) {
    var initial = arguments.length > 2;
    if (obj == null) obj = [];
    if (nativeReduceRight && obj.reduceRight === nativeReduceRight) {
      if (context) iterator = _.bind(iterator, context);
      return initial ? obj.reduceRight(iterator, memo) : obj.reduceRight(iterator);
    }
    var length = obj.length;
    if (length !== +length) {
      var keys = _.keys(obj);
      length = keys.length;
    }
    each(obj, function(value, index, list) {
      index = keys ? keys[--length] : --length;
      if (!initial) {
        memo = obj[index];
        initial = true;
      } else {
        memo = iterator.call(context, memo, obj[index], index, list);
      }
    });
    if (!initial) throw new TypeError(reduceError);
    return memo;
  };

  // Return the first value which passes a truth test. Aliased as `detect`.
  _.find = _.detect = function(obj, predicate, context) {
    var result;
    any(obj, function(value, index, list) {
      if (predicate.call(context, value, index, list)) {
        result = value;
        return true;
      }
    });
    return result;
  };

  // Return all the elements that pass a truth test.
  // Delegates to **ECMAScript 5**'s native `filter` if available.
  // Aliased as `select`.
  _.filter = _.select = function(obj, predicate, context) {
    var results = [];
    if (obj == null) return results;
    if (nativeFilter && obj.filter === nativeFilter) return obj.filter(predicate, context);
    each(obj, function(value, index, list) {
      if (predicate.call(context, value, index, list)) results.push(value);
    });
    return results;
  };

  // Return all the elements for which a truth test fails.
  _.reject = function(obj, predicate, context) {
    return _.filter(obj, function(value, index, list) {
      return !predicate.call(context, value, index, list);
    }, context);
  };

  // Determine whether all of the elements match a truth test.
  // Delegates to **ECMAScript 5**'s native `every` if available.
  // Aliased as `all`.
  _.every = _.all = function(obj, predicate, context) {
    predicate || (predicate = _.identity);
    var result = true;
    if (obj == null) return result;
    if (nativeEvery && obj.every === nativeEvery) return obj.every(predicate, context);
    each(obj, function(value, index, list) {
      if (!(result = result && predicate.call(context, value, index, list))) return breaker;
    });
    return !!result;
  };

  // Determine if at least one element in the object matches a truth test.
  // Delegates to **ECMAScript 5**'s native `some` if available.
  // Aliased as `any`.
  var any = _.some = _.any = function(obj, predicate, context) {
    predicate || (predicate = _.identity);
    var result = false;
    if (obj == null) return result;
    if (nativeSome && obj.some === nativeSome) return obj.some(predicate, context);
    each(obj, function(value, index, list) {
      if (result || (result = predicate.call(context, value, index, list))) return breaker;
    });
    return !!result;
  };

  // Determine if the array or object contains a given value (using `===`).
  // Aliased as `include`.
  _.contains = _.include = function(obj, target) {
    if (obj == null) return false;
    if (nativeIndexOf && obj.indexOf === nativeIndexOf) return obj.indexOf(target) != -1;
    return any(obj, function(value) {
      return value === target;
    });
  };

  // Invoke a method (with arguments) on every item in a collection.
  _.invoke = function(obj, method) {
    var args = slice.call(arguments, 2);
    var isFunc = _.isFunction(method);
    return _.map(obj, function(value) {
      return (isFunc ? method : value[method]).apply(value, args);
    });
  };

  // Convenience version of a common use case of `map`: fetching a property.
  _.pluck = function(obj, key) {
    return _.map(obj, _.property(key));
  };

  // Convenience version of a common use case of `filter`: selecting only objects
  // containing specific `key:value` pairs.
  _.where = function(obj, attrs) {
    return _.filter(obj, _.matches(attrs));
  };

  // Convenience version of a common use case of `find`: getting the first object
  // containing specific `key:value` pairs.
  _.findWhere = function(obj, attrs) {
    return _.find(obj, _.matches(attrs));
  };

  // Return the maximum element or (element-based computation).
  // Can't optimize arrays of integers longer than 65,535 elements.
  // See [WebKit Bug 80797](https://bugs.webkit.org/show_bug.cgi?id=80797)
  _.max = function(obj, iterator, context) {
    if (!iterator && _.isArray(obj) && obj[0] === +obj[0] && obj.length < 65535) {
      return Math.max.apply(Math, obj);
    }
    var result = -Infinity, lastComputed = -Infinity;
    each(obj, function(value, index, list) {
      var computed = iterator ? iterator.call(context, value, index, list) : value;
      if (computed > lastComputed) {
        result = value;
        lastComputed = computed;
      }
    });
    return result;
  };

  // Return the minimum element (or element-based computation).
  _.min = function(obj, iterator, context) {
    if (!iterator && _.isArray(obj) && obj[0] === +obj[0] && obj.length < 65535) {
      return Math.min.apply(Math, obj);
    }
    var result = Infinity, lastComputed = Infinity;
    each(obj, function(value, index, list) {
      var computed = iterator ? iterator.call(context, value, index, list) : value;
      if (computed < lastComputed) {
        result = value;
        lastComputed = computed;
      }
    });
    return result;
  };

  // Shuffle an array, using the modern version of the
  // [Fisher-Yates shuffle](http://en.wikipedia.org/wiki/Fisher–Yates_shuffle).
  _.shuffle = function(obj) {
    var rand;
    var index = 0;
    var shuffled = [];
    each(obj, function(value) {
      rand = _.random(index++);
      shuffled[index - 1] = shuffled[rand];
      shuffled[rand] = value;
    });
    return shuffled;
  };

  // Sample **n** random values from a collection.
  // If **n** is not specified, returns a single random element.
  // The internal `guard` argument allows it to work with `map`.
  _.sample = function(obj, n, guard) {
    if (n == null || guard) {
      if (obj.length !== +obj.length) obj = _.values(obj);
      return obj[_.random(obj.length - 1)];
    }
    return _.shuffle(obj).slice(0, Math.max(0, n));
  };

  // An internal function to generate lookup iterators.
  var lookupIterator = function(value) {
    if (value == null) return _.identity;
    if (_.isFunction(value)) return value;
    return _.property(value);
  };

  // Sort the object's values by a criterion produced by an iterator.
  _.sortBy = function(obj, iterator, context) {
    iterator = lookupIterator(iterator);
    return _.pluck(_.map(obj, function(value, index, list) {
      return {
        value: value,
        index: index,
        criteria: iterator.call(context, value, index, list)
      };
    }).sort(function(left, right) {
      var a = left.criteria;
      var b = right.criteria;
      if (a !== b) {
        if (a > b || a === void 0) return 1;
        if (a < b || b === void 0) return -1;
      }
      return left.index - right.index;
    }), 'value');
  };

  // An internal function used for aggregate "group by" operations.
  var group = function(behavior) {
    return function(obj, iterator, context) {
      var result = {};
      iterator = lookupIterator(iterator);
      each(obj, function(value, index) {
        var key = iterator.call(context, value, index, obj);
        behavior(result, key, value);
      });
      return result;
    };
  };

  // Groups the object's values by a criterion. Pass either a string attribute
  // to group by, or a function that returns the criterion.
  _.groupBy = group(function(result, key, value) {
    _.has(result, key) ? result[key].push(value) : result[key] = [value];
  });

  // Indexes the object's values by a criterion, similar to `groupBy`, but for
  // when you know that your index values will be unique.
  _.indexBy = group(function(result, key, value) {
    result[key] = value;
  });

  // Counts instances of an object that group by a certain criterion. Pass
  // either a string attribute to count by, or a function that returns the
  // criterion.
  _.countBy = group(function(result, key) {
    _.has(result, key) ? result[key]++ : result[key] = 1;
  });

  // Use a comparator function to figure out the smallest index at which
  // an object should be inserted so as to maintain order. Uses binary search.
  _.sortedIndex = function(array, obj, iterator, context) {
    iterator = lookupIterator(iterator);
    var value = iterator.call(context, obj);
    var low = 0, high = array.length;
    while (low < high) {
      var mid = (low + high) >>> 1;
      iterator.call(context, array[mid]) < value ? low = mid + 1 : high = mid;
    }
    return low;
  };

  // Safely create a real, live array from anything iterable.
  _.toArray = function(obj) {
    if (!obj) return [];
    if (_.isArray(obj)) return slice.call(obj);
    if (obj.length === +obj.length) return _.map(obj, _.identity);
    return _.values(obj);
  };

  // Return the number of elements in an object.
  _.size = function(obj) {
    if (obj == null) return 0;
    return (obj.length === +obj.length) ? obj.length : _.keys(obj).length;
  };

  // Array Functions
  // ---------------

  // Get the first element of an array. Passing **n** will return the first N
  // values in the array. Aliased as `head` and `take`. The **guard** check
  // allows it to work with `_.map`.
  _.first = _.head = _.take = function(array, n, guard) {
    if (array == null) return void 0;
    if ((n == null) || guard) return array[0];
    if (n < 0) return [];
    return slice.call(array, 0, n);
  };

  // Returns everything but the last entry of the array. Especially useful on
  // the arguments object. Passing **n** will return all the values in
  // the array, excluding the last N. The **guard** check allows it to work with
  // `_.map`.
  _.initial = function(array, n, guard) {
    return slice.call(array, 0, array.length - ((n == null) || guard ? 1 : n));
  };

  // Get the last element of an array. Passing **n** will return the last N
  // values in the array. The **guard** check allows it to work with `_.map`.
  _.last = function(array, n, guard) {
    if (array == null) return void 0;
    if ((n == null) || guard) return array[array.length - 1];
    return slice.call(array, Math.max(array.length - n, 0));
  };

  // Returns everything but the first entry of the array. Aliased as `tail` and `drop`.
  // Especially useful on the arguments object. Passing an **n** will return
  // the rest N values in the array. The **guard**
  // check allows it to work with `_.map`.
  _.rest = _.tail = _.drop = function(array, n, guard) {
    return slice.call(array, (n == null) || guard ? 1 : n);
  };

  // Trim out all falsy values from an array.
  _.compact = function(array) {
    return _.filter(array, _.identity);
  };

  // Internal implementation of a recursive `flatten` function.
  var flatten = function(input, shallow, output) {
    if (shallow && _.every(input, _.isArray)) {
      return concat.apply(output, input);
    }
    each(input, function(value) {
      if (_.isArray(value) || _.isArguments(value)) {
        shallow ? push.apply(output, value) : flatten(value, shallow, output);
      } else {
        output.push(value);
      }
    });
    return output;
  };

  // Flatten out an array, either recursively (by default), or just one level.
  _.flatten = function(array, shallow) {
    return flatten(array, shallow, []);
  };

  // Return a version of the array that does not contain the specified value(s).
  _.without = function(array) {
    return _.difference(array, slice.call(arguments, 1));
  };

  // Split an array into two arrays: one whose elements all satisfy the given
  // predicate, and one whose elements all do not satisfy the predicate.
  _.partition = function(array, predicate) {
    var pass = [], fail = [];
    each(array, function(elem) {
      (predicate(elem) ? pass : fail).push(elem);
    });
    return [pass, fail];
  };

  // Produce a duplicate-free version of the array. If the array has already
  // been sorted, you have the option of using a faster algorithm.
  // Aliased as `unique`.
  _.uniq = _.unique = function(array, isSorted, iterator, context) {
    if (_.isFunction(isSorted)) {
      context = iterator;
      iterator = isSorted;
      isSorted = false;
    }
    var initial = iterator ? _.map(array, iterator, context) : array;
    var results = [];
    var seen = [];
    each(initial, function(value, index) {
      if (isSorted ? (!index || seen[seen.length - 1] !== value) : !_.contains(seen, value)) {
        seen.push(value);
        results.push(array[index]);
      }
    });
    return results;
  };

  // Produce an array that contains the union: each distinct element from all of
  // the passed-in arrays.
  _.union = function() {
    return _.uniq(_.flatten(arguments, true));
  };

  // Produce an array that contains every item shared between all the
  // passed-in arrays.
  _.intersection = function(array) {
    var rest = slice.call(arguments, 1);
    return _.filter(_.uniq(array), function(item) {
      return _.every(rest, function(other) {
        return _.contains(other, item);
      });
    });
  };

  // Take the difference between one array and a number of other arrays.
  // Only the elements present in just the first array will remain.
  _.difference = function(array) {
    var rest = concat.apply(ArrayProto, slice.call(arguments, 1));
    return _.filter(array, function(value){ return !_.contains(rest, value); });
  };

  // Zip together multiple lists into a single array -- elements that share
  // an index go together.
  _.zip = function() {
    var length = _.max(_.pluck(arguments, 'length').concat(0));
    var results = new Array(length);
    for (var i = 0; i < length; i++) {
      results[i] = _.pluck(arguments, '' + i);
    }
    return results;
  };

  // Converts lists into objects. Pass either a single array of `[key, value]`
  // pairs, or two parallel arrays of the same length -- one of keys, and one of
  // the corresponding values.
  _.object = function(list, values) {
    if (list == null) return {};
    var result = {};
    for (var i = 0, length = list.length; i < length; i++) {
      if (values) {
        result[list[i]] = values[i];
      } else {
        result[list[i][0]] = list[i][1];
      }
    }
    return result;
  };

  // If the browser doesn't supply us with indexOf (I'm looking at you, **MSIE**),
  // we need this function. Return the position of the first occurrence of an
  // item in an array, or -1 if the item is not included in the array.
  // Delegates to **ECMAScript 5**'s native `indexOf` if available.
  // If the array is large and already in sort order, pass `true`
  // for **isSorted** to use binary search.
  _.indexOf = function(array, item, isSorted) {
    if (array == null) return -1;
    var i = 0, length = array.length;
    if (isSorted) {
      if (typeof isSorted == 'number') {
        i = (isSorted < 0 ? Math.max(0, length + isSorted) : isSorted);
      } else {
        i = _.sortedIndex(array, item);
        return array[i] === item ? i : -1;
      }
    }
    if (nativeIndexOf && array.indexOf === nativeIndexOf) return array.indexOf(item, isSorted);
    for (; i < length; i++) if (array[i] === item) return i;
    return -1;
  };

  // Delegates to **ECMAScript 5**'s native `lastIndexOf` if available.
  _.lastIndexOf = function(array, item, from) {
    if (array == null) return -1;
    var hasIndex = from != null;
    if (nativeLastIndexOf && array.lastIndexOf === nativeLastIndexOf) {
      return hasIndex ? array.lastIndexOf(item, from) : array.lastIndexOf(item);
    }
    var i = (hasIndex ? from : array.length);
    while (i--) if (array[i] === item) return i;
    return -1;
  };

  // Generate an integer Array containing an arithmetic progression. A port of
  // the native Python `range()` function. See
  // [the Python documentation](http://docs.python.org/library/functions.html#range).
  _.range = function(start, stop, step) {
    if (arguments.length <= 1) {
      stop = start || 0;
      start = 0;
    }
    step = arguments[2] || 1;

    var length = Math.max(Math.ceil((stop - start) / step), 0);
    var idx = 0;
    var range = new Array(length);

    while(idx < length) {
      range[idx++] = start;
      start += step;
    }

    return range;
  };

  // Function (ahem) Functions
  // ------------------

  // Reusable constructor function for prototype setting.
  var ctor = function(){};

  // Create a function bound to a given object (assigning `this`, and arguments,
  // optionally). Delegates to **ECMAScript 5**'s native `Function.bind` if
  // available.
  _.bind = function(func, context) {
    var args, bound;
    if (nativeBind && func.bind === nativeBind) return nativeBind.apply(func, slice.call(arguments, 1));
    if (!_.isFunction(func)) throw new TypeError;
    args = slice.call(arguments, 2);
    return bound = function() {
      if (!(this instanceof bound)) return func.apply(context, args.concat(slice.call(arguments)));
      ctor.prototype = func.prototype;
      var self = new ctor;
      ctor.prototype = null;
      var result = func.apply(self, args.concat(slice.call(arguments)));
      if (Object(result) === result) return result;
      return self;
    };
  };

  // Partially apply a function by creating a version that has had some of its
  // arguments pre-filled, without changing its dynamic `this` context. _ acts
  // as a placeholder, allowing any combination of arguments to be pre-filled.
  _.partial = function(func) {
    var boundArgs = slice.call(arguments, 1);
    return function() {
      var position = 0;
      var args = boundArgs.slice();
      for (var i = 0, length = args.length; i < length; i++) {
        if (args[i] === _) args[i] = arguments[position++];
      }
      while (position < arguments.length) args.push(arguments[position++]);
      return func.apply(this, args);
    };
  };

  // Bind a number of an object's methods to that object. Remaining arguments
  // are the method names to be bound. Useful for ensuring that all callbacks
  // defined on an object belong to it.
  _.bindAll = function(obj) {
    var funcs = slice.call(arguments, 1);
    if (funcs.length === 0) throw new Error('bindAll must be passed function names');
    each(funcs, function(f) { obj[f] = _.bind(obj[f], obj); });
    return obj;
  };

  // Memoize an expensive function by storing its results.
  _.memoize = function(func, hasher) {
    var memo = {};
    hasher || (hasher = _.identity);
    return function() {
      var key = hasher.apply(this, arguments);
      return _.has(memo, key) ? memo[key] : (memo[key] = func.apply(this, arguments));
    };
  };

  // Delays a function for the given number of milliseconds, and then calls
  // it with the arguments supplied.
  _.delay = function(func, wait) {
    var args = slice.call(arguments, 2);
    return setTimeout(function(){ return func.apply(null, args); }, wait);
  };

  // Defers a function, scheduling it to run after the current call stack has
  // cleared.
  _.defer = function(func) {
    return _.delay.apply(_, [func, 1].concat(slice.call(arguments, 1)));
  };

  // Returns a function, that, when invoked, will only be triggered at most once
  // during a given window of time. Normally, the throttled function will run
  // as much as it can, without ever going more than once per `wait` duration;
  // but if you'd like to disable the execution on the leading edge, pass
  // `{leading: false}`. To disable execution on the trailing edge, ditto.
  _.throttle = function(func, wait, options) {
    var context, args, result;
    var timeout = null;
    var previous = 0;
    options || (options = {});
    var later = function() {
      previous = options.leading === false ? 0 : _.now();
      timeout = null;
      result = func.apply(context, args);
      context = args = null;
    };
    return function() {
      var now = _.now();
      if (!previous && options.leading === false) previous = now;
      var remaining = wait - (now - previous);
      context = this;
      args = arguments;
      if (remaining <= 0) {
        clearTimeout(timeout);
        timeout = null;
        previous = now;
        result = func.apply(context, args);
        context = args = null;
      } else if (!timeout && options.trailing !== false) {
        timeout = setTimeout(later, remaining);
      }
      return result;
    };
  };

  // Returns a function, that, as long as it continues to be invoked, will not
  // be triggered. The function will be called after it stops being called for
  // N milliseconds. If `immediate` is passed, trigger the function on the
  // leading edge, instead of the trailing.
  _.debounce = function(func, wait, immediate) {
    var timeout, args, context, timestamp, result;

    var later = function() {
      var last = _.now() - timestamp;
      if (last < wait) {
        timeout = setTimeout(later, wait - last);
      } else {
        timeout = null;
        if (!immediate) {
          result = func.apply(context, args);
          context = args = null;
        }
      }
    };

    return function() {
      context = this;
      args = arguments;
      timestamp = _.now();
      var callNow = immediate && !timeout;
      if (!timeout) {
        timeout = setTimeout(later, wait);
      }
      if (callNow) {
        result = func.apply(context, args);
        context = args = null;
      }

      return result;
    };
  };

  // Returns a function that will be executed at most one time, no matter how
  // often you call it. Useful for lazy initialization.
  _.once = function(func) {
    var ran = false, memo;
    return function() {
      if (ran) return memo;
      ran = true;
      memo = func.apply(this, arguments);
      func = null;
      return memo;
    };
  };

  // Returns the first function passed as an argument to the second,
  // allowing you to adjust arguments, run code before and after, and
  // conditionally execute the original function.
  _.wrap = function(func, wrapper) {
    return _.partial(wrapper, func);
  };

  // Returns a function that is the composition of a list of functions, each
  // consuming the return value of the function that follows.
  _.compose = function() {
    var funcs = arguments;
    return function() {
      var args = arguments;
      for (var i = funcs.length - 1; i >= 0; i--) {
        args = [funcs[i].apply(this, args)];
      }
      return args[0];
    };
  };

  // Returns a function that will only be executed after being called N times.
  _.after = function(times, func) {
    return function() {
      if (--times < 1) {
        return func.apply(this, arguments);
      }
    };
  };

  // Object Functions
  // ----------------

  // Retrieve the names of an object's properties.
  // Delegates to **ECMAScript 5**'s native `Object.keys`
  _.keys = function(obj) {
    if (!_.isObject(obj)) return [];
    if (nativeKeys) return nativeKeys(obj);
    var keys = [];
    for (var key in obj) if (_.has(obj, key)) keys.push(key);
    return keys;
  };

  // Retrieve the values of an object's properties.
  _.values = function(obj) {
    var keys = _.keys(obj);
    var length = keys.length;
    var values = new Array(length);
    for (var i = 0; i < length; i++) {
      values[i] = obj[keys[i]];
    }
    return values;
  };

  // Convert an object into a list of `[key, value]` pairs.
  _.pairs = function(obj) {
    var keys = _.keys(obj);
    var length = keys.length;
    var pairs = new Array(length);
    for (var i = 0; i < length; i++) {
      pairs[i] = [keys[i], obj[keys[i]]];
    }
    return pairs;
  };

  // Invert the keys and values of an object. The values must be serializable.
  _.invert = function(obj) {
    var result = {};
    var keys = _.keys(obj);
    for (var i = 0, length = keys.length; i < length; i++) {
      result[obj[keys[i]]] = keys[i];
    }
    return result;
  };

  // Return a sorted list of the function names available on the object.
  // Aliased as `methods`
  _.functions = _.methods = function(obj) {
    var names = [];
    for (var key in obj) {
      if (_.isFunction(obj[key])) names.push(key);
    }
    return names.sort();
  };

  // Extend a given object with all the properties in passed-in object(s).
  _.extend = function(obj) {
    each(slice.call(arguments, 1), function(source) {
      if (source) {
        for (var prop in source) {
          obj[prop] = source[prop];
        }
      }
    });
    return obj;
  };

  // Return a copy of the object only containing the whitelisted properties.
  _.pick = function(obj) {
    var copy = {};
    var keys = concat.apply(ArrayProto, slice.call(arguments, 1));
    each(keys, function(key) {
      if (key in obj) copy[key] = obj[key];
    });
    return copy;
  };

   // Return a copy of the object without the blacklisted properties.
  _.omit = function(obj) {
    var copy = {};
    var keys = concat.apply(ArrayProto, slice.call(arguments, 1));
    for (var key in obj) {
      if (!_.contains(keys, key)) copy[key] = obj[key];
    }
    return copy;
  };

  // Fill in a given object with default properties.
  _.defaults = function(obj) {
    each(slice.call(arguments, 1), function(source) {
      if (source) {
        for (var prop in source) {
          if (obj[prop] === void 0) obj[prop] = source[prop];
        }
      }
    });
    return obj;
  };

  // Create a (shallow-cloned) duplicate of an object.
  _.clone = function(obj) {
    if (!_.isObject(obj)) return obj;
    return _.isArray(obj) ? obj.slice() : _.extend({}, obj);
  };

  // Invokes interceptor with the obj, and then returns obj.
  // The primary purpose of this method is to "tap into" a method chain, in
  // order to perform operations on intermediate results within the chain.
  _.tap = function(obj, interceptor) {
    interceptor(obj);
    return obj;
  };

  // Internal recursive comparison function for `isEqual`.
  var eq = function(a, b, aStack, bStack) {
    // Identical objects are equal. `0 === -0`, but they aren't identical.
    // See the [Harmony `egal` proposal](http://wiki.ecmascript.org/doku.php?id=harmony:egal).
    if (a === b) return a !== 0 || 1 / a == 1 / b;
    // A strict comparison is necessary because `null == undefined`.
    if (a == null || b == null) return a === b;
    // Unwrap any wrapped objects.
    if (a instanceof _) a = a._wrapped;
    if (b instanceof _) b = b._wrapped;
    // Compare `[[Class]]` names.
    var className = toString.call(a);
    if (className != toString.call(b)) return false;
    switch (className) {
      // Strings, numbers, dates, and booleans are compared by value.
      case '[object String]':
        // Primitives and their corresponding object wrappers are equivalent; thus, `"5"` is
        // equivalent to `new String("5")`.
        return a == String(b);
      case '[object Number]':
        // `NaN`s are equivalent, but non-reflexive. An `egal` comparison is performed for
        // other numeric values.
        return a != +a ? b != +b : (a == 0 ? 1 / a == 1 / b : a == +b);
      case '[object Date]':
      case '[object Boolean]':
        // Coerce dates and booleans to numeric primitive values. Dates are compared by their
        // millisecond representations. Note that invalid dates with millisecond representations
        // of `NaN` are not equivalent.
        return +a == +b;
      // RegExps are compared by their source patterns and flags.
      case '[object RegExp]':
        return a.source == b.source &&
               a.global == b.global &&
               a.multiline == b.multiline &&
               a.ignoreCase == b.ignoreCase;
    }
    if (typeof a != 'object' || typeof b != 'object') return false;
    // Assume equality for cyclic structures. The algorithm for detecting cyclic
    // structures is adapted from ES 5.1 section 15.12.3, abstract operation `JO`.
    var length = aStack.length;
    while (length--) {
      // Linear search. Performance is inversely proportional to the number of
      // unique nested structures.
      if (aStack[length] == a) return bStack[length] == b;
    }
    // Objects with different constructors are not equivalent, but `Object`s
    // from different frames are.
    var aCtor = a.constructor, bCtor = b.constructor;
    if (aCtor !== bCtor && !(_.isFunction(aCtor) && (aCtor instanceof aCtor) &&
                             _.isFunction(bCtor) && (bCtor instanceof bCtor))
                        && ('constructor' in a && 'constructor' in b)) {
      return false;
    }
    // Add the first object to the stack of traversed objects.
    aStack.push(a);
    bStack.push(b);
    var size = 0, result = true;
    // Recursively compare objects and arrays.
    if (className == '[object Array]') {
      // Compare array lengths to determine if a deep comparison is necessary.
      size = a.length;
      result = size == b.length;
      if (result) {
        // Deep compare the contents, ignoring non-numeric properties.
        while (size--) {
          if (!(result = eq(a[size], b[size], aStack, bStack))) break;
        }
      }
    } else {
      // Deep compare objects.
      for (var key in a) {
        if (_.has(a, key)) {
          // Count the expected number of properties.
          size++;
          // Deep compare each member.
          if (!(result = _.has(b, key) && eq(a[key], b[key], aStack, bStack))) break;
        }
      }
      // Ensure that both objects contain the same number of properties.
      if (result) {
        for (key in b) {
          if (_.has(b, key) && !(size--)) break;
        }
        result = !size;
      }
    }
    // Remove the first object from the stack of traversed objects.
    aStack.pop();
    bStack.pop();
    return result;
  };

  // Perform a deep comparison to check if two objects are equal.
  _.isEqual = function(a, b) {
    return eq(a, b, [], []);
  };

  // Is a given array, string, or object empty?
  // An "empty" object has no enumerable own-properties.
  _.isEmpty = function(obj) {
    if (obj == null) return true;
    if (_.isArray(obj) || _.isString(obj)) return obj.length === 0;
    for (var key in obj) if (_.has(obj, key)) return false;
    return true;
  };

  // Is a given value a DOM element?
  _.isElement = function(obj) {
    return !!(obj && obj.nodeType === 1);
  };

  // Is a given value an array?
  // Delegates to ECMA5's native Array.isArray
  _.isArray = nativeIsArray || function(obj) {
    return toString.call(obj) == '[object Array]';
  };

  // Is a given variable an object?
  _.isObject = function(obj) {
    return obj === Object(obj);
  };

  // Add some isType methods: isArguments, isFunction, isString, isNumber, isDate, isRegExp.
  each(['Arguments', 'Function', 'String', 'Number', 'Date', 'RegExp'], function(name) {
    _['is' + name] = function(obj) {
      return toString.call(obj) == '[object ' + name + ']';
    };
  });

  // Define a fallback version of the method in browsers (ahem, IE), where
  // there isn't any inspectable "Arguments" type.
  if (!_.isArguments(arguments)) {
    _.isArguments = function(obj) {
      return !!(obj && _.has(obj, 'callee'));
    };
  }

  // Optimize `isFunction` if appropriate.
  if (typeof (/./) !== 'function') {
    _.isFunction = function(obj) {
      return typeof obj === 'function';
    };
  }

  // Is a given object a finite number?
  _.isFinite = function(obj) {
    return isFinite(obj) && !isNaN(parseFloat(obj));
  };

  // Is the given value `NaN`? (NaN is the only number which does not equal itself).
  _.isNaN = function(obj) {
    return _.isNumber(obj) && obj != +obj;
  };

  // Is a given value a boolean?
  _.isBoolean = function(obj) {
    return obj === true || obj === false || toString.call(obj) == '[object Boolean]';
  };

  // Is a given value equal to null?
  _.isNull = function(obj) {
    return obj === null;
  };

  // Is a given variable undefined?
  _.isUndefined = function(obj) {
    return obj === void 0;
  };

  // Shortcut function for checking if an object has a given property directly
  // on itself (in other words, not on a prototype).
  _.has = function(obj, key) {
    return hasOwnProperty.call(obj, key);
  };

  // Utility Functions
  // -----------------

  // Run Underscore.js in *noConflict* mode, returning the `_` variable to its
  // previous owner. Returns a reference to the Underscore object.
  _.noConflict = function() {
    root._ = previousUnderscore;
    return this;
  };

  // Keep the identity function around for default iterators.
  _.identity = function(value) {
    return value;
  };

  _.constant = function(value) {
    return function () {
      return value;
    };
  };

  _.property = function(key) {
    return function(obj) {
      return obj[key];
    };
  };

  // Returns a predicate for checking whether an object has a given set of `key:value` pairs.
  _.matches = function(attrs) {
    return function(obj) {
      if (obj === attrs) return true; //avoid comparing an object to itself.
      for (var key in attrs) {
        if (attrs[key] !== obj[key])
          return false;
      }
      return true;
    }
  };

  // Run a function **n** times.
  _.times = function(n, iterator, context) {
    var accum = Array(Math.max(0, n));
    for (var i = 0; i < n; i++) accum[i] = iterator.call(context, i);
    return accum;
  };

  // Return a random integer between min and max (inclusive).
  _.random = function(min, max) {
    if (max == null) {
      max = min;
      min = 0;
    }
    return min + Math.floor(Math.random() * (max - min + 1));
  };

  // A (possibly faster) way to get the current timestamp as an integer.
  _.now = Date.now || function() { return new Date().getTime(); };

  // List of HTML entities for escaping.
  var entityMap = {
    escape: {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#x27;'
    }
  };
  entityMap.unescape = _.invert(entityMap.escape);

  // Regexes containing the keys and values listed immediately above.
  var entityRegexes = {
    escape:   new RegExp('[' + _.keys(entityMap.escape).join('') + ']', 'g'),
    unescape: new RegExp('(' + _.keys(entityMap.unescape).join('|') + ')', 'g')
  };

  // Functions for escaping and unescaping strings to/from HTML interpolation.
  _.each(['escape', 'unescape'], function(method) {
    _[method] = function(string) {
      if (string == null) return '';
      return ('' + string).replace(entityRegexes[method], function(match) {
        return entityMap[method][match];
      });
    };
  });

  // If the value of the named `property` is a function then invoke it with the
  // `object` as context; otherwise, return it.
  _.result = function(object, property) {
    if (object == null) return void 0;
    var value = object[property];
    return _.isFunction(value) ? value.call(object) : value;
  };

  // Add your own custom functions to the Underscore object.
  _.mixin = function(obj) {
    each(_.functions(obj), function(name) {
      var func = _[name] = obj[name];
      _.prototype[name] = function() {
        var args = [this._wrapped];
        push.apply(args, arguments);
        return result.call(this, func.apply(_, args));
      };
    });
  };

  // Generate a unique integer id (unique within the entire client session).
  // Useful for temporary DOM ids.
  var idCounter = 0;
  _.uniqueId = function(prefix) {
    var id = ++idCounter + '';
    return prefix ? prefix + id : id;
  };

  // By default, Underscore uses ERB-style template delimiters, change the
  // following template settings to use alternative delimiters.
  _.templateSettings = {
    evaluate    : /<%([\s\S]+?)%>/g,
    interpolate : /<%=([\s\S]+?)%>/g,
    escape      : /<%-([\s\S]+?)%>/g
  };

  // When customizing `templateSettings`, if you don't want to define an
  // interpolation, evaluation or escaping regex, we need one that is
  // guaranteed not to match.
  var noMatch = /(.)^/;

  // Certain characters need to be escaped so that they can be put into a
  // string literal.
  var escapes = {
    "'":      "'",
    '\\':     '\\',
    '\r':     'r',
    '\n':     'n',
    '\t':     't',
    '\u2028': 'u2028',
    '\u2029': 'u2029'
  };

  var escaper = /\\|'|\r|\n|\t|\u2028|\u2029/g;

  // JavaScript micro-templating, similar to John Resig's implementation.
  // Underscore templating handles arbitrary delimiters, preserves whitespace,
  // and correctly escapes quotes within interpolated code.
  _.template = function(text, data, settings) {
    var render;
    settings = _.defaults({}, settings, _.templateSettings);

    // Combine delimiters into one regular expression via alternation.
    var matcher = new RegExp([
      (settings.escape || noMatch).source,
      (settings.interpolate || noMatch).source,
      (settings.evaluate || noMatch).source
    ].join('|') + '|$', 'g');

    // Compile the template source, escaping string literals appropriately.
    var index = 0;
    var source = "__p+='";
    text.replace(matcher, function(match, escape, interpolate, evaluate, offset) {
      source += text.slice(index, offset)
        .replace(escaper, function(match) { return '\\' + escapes[match]; });

      if (escape) {
        source += "'+\n((__t=(" + escape + "))==null?'':_.escape(__t))+\n'";
      }
      if (interpolate) {
        source += "'+\n((__t=(" + interpolate + "))==null?'':__t)+\n'";
      }
      if (evaluate) {
        source += "';\n" + evaluate + "\n__p+='";
      }
      index = offset + match.length;
      return match;
    });
    source += "';\n";

    // If a variable is not specified, place data values in local scope.
    if (!settings.variable) source = 'with(obj||{}){\n' + source + '}\n';

    source = "var __t,__p='',__j=Array.prototype.join," +
      "print=function(){__p+=__j.call(arguments,'');};\n" +
      source + "return __p;\n";

    try {
      render = new Function(settings.variable || 'obj', '_', source);
    } catch (e) {
      e.source = source;
      throw e;
    }

    if (data) return render(data, _);
    var template = function(data) {
      return render.call(this, data, _);
    };

    // Provide the compiled function source as a convenience for precompilation.
    template.source = 'function(' + (settings.variable || 'obj') + '){\n' + source + '}';

    return template;
  };

  // Add a "chain" function, which will delegate to the wrapper.
  _.chain = function(obj) {
    return _(obj).chain();
  };

  // OOP
  // ---------------
  // If Underscore is called as a function, it returns a wrapped object that
  // can be used OO-style. This wrapper holds altered versions of all the
  // underscore functions. Wrapped objects may be chained.

  // Helper function to continue chaining intermediate results.
  var result = function(obj) {
    return this._chain ? _(obj).chain() : obj;
  };

  // Add all of the Underscore functions to the wrapper object.
  _.mixin(_);

  // Add all mutator Array functions to the wrapper.
  each(['pop', 'push', 'reverse', 'shift', 'sort', 'splice', 'unshift'], function(name) {
    var method = ArrayProto[name];
    _.prototype[name] = function() {
      var obj = this._wrapped;
      method.apply(obj, arguments);
      if ((name == 'shift' || name == 'splice') && obj.length === 0) delete obj[0];
      return result.call(this, obj);
    };
  });

  // Add all accessor Array functions to the wrapper.
  each(['concat', 'join', 'slice'], function(name) {
    var method = ArrayProto[name];
    _.prototype[name] = function() {
      return result.call(this, method.apply(this._wrapped, arguments));
    };
  });

  _.extend(_.prototype, {

    // Start chaining a wrapped Underscore object.
    chain: function() {
      this._chain = true;
      return this;
    },

    // Extracts the result from a wrapped and chained object.
    value: function() {
      return this._wrapped;
    }

  });

  // AMD registration happens at the end for compatibility with AMD loaders
  // that may not enforce next-turn semantics on modules. Even though general
  // practice for AMD registration is to be anonymous, underscore registers
  // as a named module because, like jQuery, it is a base library that is
  // popular enough to be bundled in a third party lib, but not be part of
  // an AMD load request. Those cases could generate an error when an
  // anonymous define() is called outside of a loader request.
  if (typeof define === 'function' && define.amd) {
    define('underscore', [], function() {
      return _;
    });
  }
}).call(this);

//     Backbone.js 1.0.0

//     (c) 2010-2013 Jeremy Ashkenas, DocumentCloud Inc.
//     Backbone may be freely distributed under the MIT license.
//     For all details and documentation:
//     http://backbonejs.org

(function(){

  // Initial Setup
  // -------------

  // Save a reference to the global object (`window` in the browser, `exports`
  // on the server).
  var root = this;

  // Save the previous value of the `Backbone` variable, so that it can be
  // restored later on, if `noConflict` is used.
  var previousBackbone = root.Backbone;

  // Create local references to array methods we'll want to use later.
  var array = [];
  var push = array.push;
  var slice = array.slice;
  var splice = array.splice;

  // The top-level namespace. All public Backbone classes and modules will
  // be attached to this. Exported for both the browser and the server.
  var Backbone;
  if (typeof exports !== 'undefined') {
    Backbone = exports;
  } else {
    Backbone = root.Backbone = {};
  }

  // Current version of the library. Keep in sync with `package.json`.
  Backbone.VERSION = '1.0.0';

  // Require Underscore, if we're on the server, and it's not already present.
  var _ = root._;
  if (!_ && (typeof require !== 'undefined')) _ = require('underscore');

  // For Backbone's purposes, jQuery, Zepto, Ender, or My Library (kidding) owns
  // the `$` variable.
  Backbone.$ = root.jQuery || root.Zepto || root.ender || root.$;

  // Runs Backbone.js in *noConflict* mode, returning the `Backbone` variable
  // to its previous owner. Returns a reference to this Backbone object.
  Backbone.noConflict = function() {
    root.Backbone = previousBackbone;
    return this;
  };

  // Turn on `emulateHTTP` to support legacy HTTP servers. Setting this option
  // will fake `"PUT"` and `"DELETE"` requests via the `_method` parameter and
  // set a `X-Http-Method-Override` header.
  Backbone.emulateHTTP = false;

  // Turn on `emulateJSON` to support legacy servers that can't deal with direct
  // `application/json` requests ... will encode the body as
  // `application/x-www-form-urlencoded` instead and will send the model in a
  // form param named `model`.
  Backbone.emulateJSON = false;

  // Backbone.Events
  // ---------------

  // A module that can be mixed in to *any object* in order to provide it with
  // custom events. You may bind with `on` or remove with `off` callback
  // functions to an event; `trigger`-ing an event fires all callbacks in
  // succession.
  //
  //     var object = {};
  //     _.extend(object, Backbone.Events);
  //     object.on('expand', function(){ alert('expanded'); });
  //     object.trigger('expand');
  //
  var Events = Backbone.Events = {

    // Bind an event to a `callback` function. Passing `"all"` will bind
    // the callback to all events fired.
    on: function(name, callback, context) {
      if (!eventsApi(this, 'on', name, [callback, context]) || !callback) return this;
      this._events || (this._events = {});
      var events = this._events[name] || (this._events[name] = []);
      events.push({callback: callback, context: context, ctx: context || this});
      return this;
    },

    // Bind an event to only be triggered a single time. After the first time
    // the callback is invoked, it will be removed.
    once: function(name, callback, context) {
      if (!eventsApi(this, 'once', name, [callback, context]) || !callback) return this;
      var self = this;
      var once = _.once(function() {
        self.off(name, once);
        callback.apply(this, arguments);
      });
      once._callback = callback;
      return this.on(name, once, context);
    },

    // Remove one or many callbacks. If `context` is null, removes all
    // callbacks with that function. If `callback` is null, removes all
    // callbacks for the event. If `name` is null, removes all bound
    // callbacks for all events.
    off: function(name, callback, context) {
      var retain, ev, events, names, i, l, j, k;
      if (!this._events || !eventsApi(this, 'off', name, [callback, context])) return this;
      if (!name && !callback && !context) {
        this._events = {};
        return this;
      }

      names = name ? [name] : _.keys(this._events);
      for (i = 0, l = names.length; i < l; i++) {
        name = names[i];
        if (events = this._events[name]) {
          this._events[name] = retain = [];
          if (callback || context) {
            for (j = 0, k = events.length; j < k; j++) {
              ev = events[j];
              if ((callback && callback !== ev.callback && callback !== ev.callback._callback) ||
                  (context && context !== ev.context)) {
                retain.push(ev);
              }
            }
          }
          if (!retain.length) delete this._events[name];
        }
      }

      return this;
    },

    // Trigger one or many events, firing all bound callbacks. Callbacks are
    // passed the same arguments as `trigger` is, apart from the event name
    // (unless you're listening on `"all"`, which will cause your callback to
    // receive the true name of the event as the first argument).
    trigger: function(name) {
      if (!this._events) return this;
      var args = slice.call(arguments, 1);
      if (!eventsApi(this, 'trigger', name, args)) return this;
      var events = this._events[name];
      var allEvents = this._events.all;
      if (events) triggerEvents(events, args);
      if (allEvents) triggerEvents(allEvents, arguments);
      return this;
    },

    // Tell this object to stop listening to either specific events ... or
    // to every object it's currently listening to.
    stopListening: function(obj, name, callback) {
      var listeners = this._listeners;
      if (!listeners) return this;
      var deleteListener = !name && !callback;
      if (typeof name === 'object') callback = this;
      if (obj) (listeners = {})[obj._listenerId] = obj;
      for (var id in listeners) {
        listeners[id].off(name, callback, this);
        if (deleteListener) delete this._listeners[id];
      }
      return this;
    }

  };

  // Regular expression used to split event strings.
  var eventSplitter = /\s+/;

  // Implement fancy features of the Events API such as multiple event
  // names `"change blur"` and jQuery-style event maps `{change: action}`
  // in terms of the existing API.
  var eventsApi = function(obj, action, name, rest) {
    if (!name) return true;

    // Handle event maps.
    if (typeof name === 'object') {
      for (var key in name) {
        obj[action].apply(obj, [key, name[key]].concat(rest));
      }
      return false;
    }

    // Handle space separated event names.
    if (eventSplitter.test(name)) {
      var names = name.split(eventSplitter);
      for (var i = 0, l = names.length; i < l; i++) {
        obj[action].apply(obj, [names[i]].concat(rest));
      }
      return false;
    }

    return true;
  };

  // A difficult-to-believe, but optimized internal dispatch function for
  // triggering events. Tries to keep the usual cases speedy (most internal
  // Backbone events have 3 arguments).
  var triggerEvents = function(events, args) {
    var ev, i = -1, l = events.length, a1 = args[0], a2 = args[1], a3 = args[2];
    switch (args.length) {
      case 0: while (++i < l) (ev = events[i]).callback.call(ev.ctx); return;
      case 1: while (++i < l) (ev = events[i]).callback.call(ev.ctx, a1); return;
      case 2: while (++i < l) (ev = events[i]).callback.call(ev.ctx, a1, a2); return;
      case 3: while (++i < l) (ev = events[i]).callback.call(ev.ctx, a1, a2, a3); return;
      default: while (++i < l) (ev = events[i]).callback.apply(ev.ctx, args);
    }
  };

  var listenMethods = {listenTo: 'on', listenToOnce: 'once'};

  // Inversion-of-control versions of `on` and `once`. Tell *this* object to
  // listen to an event in another object ... keeping track of what it's
  // listening to.
  _.each(listenMethods, function(implementation, method) {
    Events[method] = function(obj, name, callback) {
      var listeners = this._listeners || (this._listeners = {});
      var id = obj._listenerId || (obj._listenerId = _.uniqueId('l'));
      listeners[id] = obj;
      if (typeof name === 'object') callback = this;
      obj[implementation](name, callback, this);
      return this;
    };
  });

  // Aliases for backwards compatibility.
  Events.bind   = Events.on;
  Events.unbind = Events.off;

  // Allow the `Backbone` object to serve as a global event bus, for folks who
  // want global "pubsub" in a convenient place.
  _.extend(Backbone, Events);

  // Backbone.Model
  // --------------

  // Backbone **Models** are the basic data object in the framework --
  // frequently representing a row in a table in a database on your server.
  // A discrete chunk of data and a bunch of useful, related methods for
  // performing computations and transformations on that data.

  // Create a new model with the specified attributes. A client id (`cid`)
  // is automatically generated and assigned for you.
  var Model = Backbone.Model = function(attributes, options) {
    var defaults;
    var attrs = attributes || {};
    options || (options = {});
    this.cid = _.uniqueId('c');
    this.attributes = {};
    _.extend(this, _.pick(options, modelOptions));
    if (options.parse) attrs = this.parse(attrs, options) || {};
    if (defaults = _.result(this, 'defaults')) {
      attrs = _.defaults({}, attrs, defaults);
    }
    this.set(attrs, options);
    this.changed = {};
    this.initialize.apply(this, arguments);
  };

  // A list of options to be attached directly to the model, if provided.
  var modelOptions = ['url', 'urlRoot', 'collection'];

  // Attach all inheritable methods to the Model prototype.
  _.extend(Model.prototype, Events, {

    // A hash of attributes whose current and previous value differ.
    changed: null,

    // The value returned during the last failed validation.
    validationError: null,

    // The default name for the JSON `id` attribute is `"id"`. MongoDB and
    // CouchDB users may want to set this to `"_id"`.
    idAttribute: 'id',

    // Initialize is an empty function by default. Override it with your own
    // initialization logic.
    initialize: function(){},

    // Return a copy of the model's `attributes` object.
    toJSON: function(options) {
      return _.clone(this.attributes);
    },

    // Proxy `Backbone.sync` by default -- but override this if you need
    // custom syncing semantics for *this* particular model.
    sync: function() {
      return Backbone.sync.apply(this, arguments);
    },

    // Get the value of an attribute.
    get: function(attr) {
      return this.attributes[attr];
    },

    // Get the HTML-escaped value of an attribute.
    escape: function(attr) {
      return _.escape(this.get(attr));
    },

    // Returns `true` if the attribute contains a value that is not null
    // or undefined.
    has: function(attr) {
      return this.get(attr) != null;
    },

    // Set a hash of model attributes on the object, firing `"change"`. This is
    // the core primitive operation of a model, updating the data and notifying
    // anyone who needs to know about the change in state. The heart of the beast.
    set: function(key, val, options) {
      var attr, attrs, unset, changes, silent, changing, prev, current;
      if (key == null) return this;

      // Handle both `"key", value` and `{key: value}` -style arguments.
      if (typeof key === 'object') {
        attrs = key;
        options = val;
      } else {
        (attrs = {})[key] = val;
      }

      options || (options = {});

      // Run validation.
      if (!this._validate(attrs, options)) return false;

      // Extract attributes and options.
      unset           = options.unset;
      silent          = options.silent;
      changes         = [];
      changing        = this._changing;
      this._changing  = true;

      if (!changing) {
        this._previousAttributes = _.clone(this.attributes);
        this.changed = {};
      }
      current = this.attributes, prev = this._previousAttributes;

      // Check for changes of `id`.
      if (this.idAttribute in attrs) this.id = attrs[this.idAttribute];

      // For each `set` attribute, update or delete the current value.
      for (attr in attrs) {
        val = attrs[attr];
        if (!_.isEqual(current[attr], val)) changes.push(attr);
        if (!_.isEqual(prev[attr], val)) {
          this.changed[attr] = val;
        } else {
          delete this.changed[attr];
        }
        unset ? delete current[attr] : current[attr] = val;
      }

      // Trigger all relevant attribute changes.
      if (!silent) {
        if (changes.length) this._pending = true;
        for (var i = 0, l = changes.length; i < l; i++) {
          this.trigger('change:' + changes[i], this, current[changes[i]], options);
        }
      }

      // You might be wondering why there's a `while` loop here. Changes can
      // be recursively nested within `"change"` events.
      if (changing) return this;
      if (!silent) {
        while (this._pending) {
          this._pending = false;
          this.trigger('change', this, options);
        }
      }
      this._pending = false;
      this._changing = false;
      return this;
    },

    // Remove an attribute from the model, firing `"change"`. `unset` is a noop
    // if the attribute doesn't exist.
    unset: function(attr, options) {
      return this.set(attr, void 0, _.extend({}, options, {unset: true}));
    },

    // Clear all attributes on the model, firing `"change"`.
    clear: function(options) {
      var attrs = {};
      for (var key in this.attributes) attrs[key] = void 0;
      return this.set(attrs, _.extend({}, options, {unset: true}));
    },

    // Determine if the model has changed since the last `"change"` event.
    // If you specify an attribute name, determine if that attribute has changed.
    hasChanged: function(attr) {
      if (attr == null) return !_.isEmpty(this.changed);
      return _.has(this.changed, attr);
    },

    // Return an object containing all the attributes that have changed, or
    // false if there are no changed attributes. Useful for determining what
    // parts of a view need to be updated and/or what attributes need to be
    // persisted to the server. Unset attributes will be set to undefined.
    // You can also pass an attributes object to diff against the model,
    // determining if there *would be* a change.
    changedAttributes: function(diff) {
      if (!diff) return this.hasChanged() ? _.clone(this.changed) : false;
      var val, changed = false;
      var old = this._changing ? this._previousAttributes : this.attributes;
      for (var attr in diff) {
        if (_.isEqual(old[attr], (val = diff[attr]))) continue;
        (changed || (changed = {}))[attr] = val;
      }
      return changed;
    },

    // Get the previous value of an attribute, recorded at the time the last
    // `"change"` event was fired.
    previous: function(attr) {
      if (attr == null || !this._previousAttributes) return null;
      return this._previousAttributes[attr];
    },

    // Get all of the attributes of the model at the time of the previous
    // `"change"` event.
    previousAttributes: function() {
      return _.clone(this._previousAttributes);
    },

    // Fetch the model from the server. If the server's representation of the
    // model differs from its current attributes, they will be overridden,
    // triggering a `"change"` event.
    fetch: function(options) {
      options = options ? _.clone(options) : {};
      if (options.parse === void 0) options.parse = true;
      var model = this;
      var success = options.success;
      options.success = function(resp) {
        if (!model.set(model.parse(resp, options), options)) return false;
        if (success) success(model, resp, options);
        model.trigger('sync', model, resp, options);
      };
      wrapError(this, options);
      return this.sync('read', this, options);
    },

    // Set a hash of model attributes, and sync the model to the server.
    // If the server returns an attributes hash that differs, the model's
    // state will be `set` again.
    save: function(key, val, options) {
      var attrs, method, xhr, attributes = this.attributes;

      // Handle both `"key", value` and `{key: value}` -style arguments.
      if (key == null || typeof key === 'object') {
        attrs = key;
        options = val;
      } else {
        (attrs = {})[key] = val;
      }

      // If we're not waiting and attributes exist, save acts as `set(attr).save(null, opts)`.
      if (attrs && (!options || !options.wait) && !this.set(attrs, options)) return false;

      options = _.extend({validate: true}, options);

      // Do not persist invalid models.
      if (!this._validate(attrs, options)) return false;

      // Set temporary attributes if `{wait: true}`.
      if (attrs && options.wait) {
        this.attributes = _.extend({}, attributes, attrs);
      }

      // After a successful server-side save, the client is (optionally)
      // updated with the server-side state.
      if (options.parse === void 0) options.parse = true;
      var model = this;
      var success = options.success;
      options.success = function(resp) {
        // Ensure attributes are restored during synchronous saves.
        model.attributes = attributes;
        var serverAttrs = model.parse(resp, options);
        if (options.wait) serverAttrs = _.extend(attrs || {}, serverAttrs);
        if (_.isObject(serverAttrs) && !model.set(serverAttrs, options)) {
          return false;
        }
        if (success) success(model, resp, options);
        model.trigger('sync', model, resp, options);
      };
      wrapError(this, options);

      method = this.isNew() ? 'create' : (options.patch ? 'patch' : 'update');
      if (method === 'patch') options.attrs = attrs;
      xhr = this.sync(method, this, options);

      // Restore attributes.
      if (attrs && options.wait) this.attributes = attributes;

      return xhr;
    },

    // Destroy this model on the server if it was already persisted.
    // Optimistically removes the model from its collection, if it has one.
    // If `wait: true` is passed, waits for the server to respond before removal.
    destroy: function(options) {
      options = options ? _.clone(options) : {};
      var model = this;
      var success = options.success;

      var destroy = function() {
        model.trigger('destroy', model, model.collection, options);
      };

      options.success = function(resp) {
        if (options.wait || model.isNew()) destroy();
        if (success) success(model, resp, options);
        if (!model.isNew()) model.trigger('sync', model, resp, options);
      };

      if (this.isNew()) {
        options.success();
        return false;
      }
      wrapError(this, options);

      var xhr = this.sync('delete', this, options);
      if (!options.wait) destroy();
      return xhr;
    },

    // Default URL for the model's representation on the server -- if you're
    // using Backbone's restful methods, override this to change the endpoint
    // that will be called.
    url: function() {
      var base = _.result(this, 'urlRoot') || _.result(this.collection, 'url') || urlError();
      if (this.isNew()) return base;
      return base + (base.charAt(base.length - 1) === '/' ? '' : '/') + encodeURIComponent(this.id);
    },

    // **parse** converts a response into the hash of attributes to be `set` on
    // the model. The default implementation is just to pass the response along.
    parse: function(resp, options) {
      return resp;
    },

    // Create a new model with identical attributes to this one.
    clone: function() {
      return new this.constructor(this.attributes);
    },

    // A model is new if it has never been saved to the server, and lacks an id.
    isNew: function() {
      return this.id == null;
    },

    // Check if the model is currently in a valid state.
    isValid: function(options) {
      return this._validate({}, _.extend(options || {}, { validate: true }));
    },

    // Run validation against the next complete set of model attributes,
    // returning `true` if all is well. Otherwise, fire an `"invalid"` event.
    _validate: function(attrs, options) {
      if (!options.validate || !this.validate) return true;
      attrs = _.extend({}, this.attributes, attrs);
      var error = this.validationError = this.validate(attrs, options) || null;
      if (!error) return true;
      this.trigger('invalid', this, error, _.extend(options || {}, {validationError: error}));
      return false;
    }

  });

  // Underscore methods that we want to implement on the Model.
  var modelMethods = ['keys', 'values', 'pairs', 'invert', 'pick', 'omit'];

  // Mix in each Underscore method as a proxy to `Model#attributes`.
  _.each(modelMethods, function(method) {
    Model.prototype[method] = function() {
      var args = slice.call(arguments);
      args.unshift(this.attributes);
      return _[method].apply(_, args);
    };
  });

  // Backbone.Collection
  // -------------------

  // If models tend to represent a single row of data, a Backbone Collection is
  // more analagous to a table full of data ... or a small slice or page of that
  // table, or a collection of rows that belong together for a particular reason
  // -- all of the messages in this particular folder, all of the documents
  // belonging to this particular author, and so on. Collections maintain
  // indexes of their models, both in order, and for lookup by `id`.

  // Create a new **Collection**, perhaps to contain a specific type of `model`.
  // If a `comparator` is specified, the Collection will maintain
  // its models in sort order, as they're added and removed.
  var Collection = Backbone.Collection = function(models, options) {
    options || (options = {});
    if (options.url) this.url = options.url;
    if (options.model) this.model = options.model;
    if (options.comparator !== void 0) this.comparator = options.comparator;
    this._reset();
    this.initialize.apply(this, arguments);
    if (models) this.reset(models, _.extend({silent: true}, options));
  };

  // Default options for `Collection#set`.
  var setOptions = {add: true, remove: true, merge: true};
  var addOptions = {add: true, merge: false, remove: false};

  // Define the Collection's inheritable methods.
  _.extend(Collection.prototype, Events, {

    // The default model for a collection is just a **Backbone.Model**.
    // This should be overridden in most cases.
    model: Model,

    // Initialize is an empty function by default. Override it with your own
    // initialization logic.
    initialize: function(){},

    // The JSON representation of a Collection is an array of the
    // models' attributes.
    toJSON: function(options) {
      return this.map(function(model){ return model.toJSON(options); });
    },

    // Proxy `Backbone.sync` by default.
    sync: function() {
      return Backbone.sync.apply(this, arguments);
    },

    // Add a model, or list of models to the set.
    add: function(models, options) {
      return this.set(models, _.defaults(options || {}, addOptions));
    },

    // Remove a model, or a list of models from the set.
    remove: function(models, options) {
      models = _.isArray(models) ? models.slice() : [models];
      options || (options = {});
      var i, l, index, model;
      for (i = 0, l = models.length; i < l; i++) {
        model = this.get(models[i]);
        if (!model) continue;
        delete this._byId[model.id];
        delete this._byId[model.cid];
        index = this.indexOf(model);
        this.models.splice(index, 1);
        this.length--;
        if (!options.silent) {
          options.index = index;
          model.trigger('remove', model, this, options);
        }
        this._removeReference(model);
      }
      return this;
    },

    // Update a collection by `set`-ing a new list of models, adding new ones,
    // removing models that are no longer present, and merging models that
    // already exist in the collection, as necessary. Similar to **Model#set**,
    // the core operation for updating the data contained by the collection.
    set: function(models, options) {
      options = _.defaults(options || {}, setOptions);
      if (options.parse) models = this.parse(models, options);
      if (!_.isArray(models)) models = models ? [models] : [];
      var i, l, model, attrs, existing, sort;
      var at = options.at;
      var sortable = this.comparator && (at == null) && options.sort !== false;
      var sortAttr = _.isString(this.comparator) ? this.comparator : null;
      var toAdd = [], toRemove = [], modelMap = {};

      // Turn bare objects into model references, and prevent invalid models
      // from being added.
      for (i = 0, l = models.length; i < l; i++) {
        if (!(model = this._prepareModel(models[i], options))) continue;

        // If a duplicate is found, prevent it from being added and
        // optionally merge it into the existing model.
        if (existing = this.get(model)) {
          if (options.remove) modelMap[existing.cid] = true;
          if (options.merge) {
            existing.set(model.attributes, options);
            if (sortable && !sort && existing.hasChanged(sortAttr)) sort = true;
          }

        // This is a new model, push it to the `toAdd` list.
        } else if (options.add) {
          toAdd.push(model);

          // Listen to added models' events, and index models for lookup by
          // `id` and by `cid`.
          model.on('all', this._onModelEvent, this);
          this._byId[model.cid] = model;
          if (model.id != null) this._byId[model.id] = model;
        }
      }

      // Remove nonexistent models if appropriate.
      if (options.remove) {
        for (i = 0, l = this.length; i < l; ++i) {
          if (!modelMap[(model = this.models[i]).cid]) toRemove.push(model);
        }
        if (toRemove.length) this.remove(toRemove, options);
      }

      // See if sorting is needed, update `length` and splice in new models.
      if (toAdd.length) {
        if (sortable) sort = true;
        this.length += toAdd.length;
        if (at != null) {
          splice.apply(this.models, [at, 0].concat(toAdd));
        } else {
          push.apply(this.models, toAdd);
        }
      }

      // Silently sort the collection if appropriate.
      if (sort) this.sort({silent: true});

      if (options.silent) return this;

      // Trigger `add` events.
      for (i = 0, l = toAdd.length; i < l; i++) {
        (model = toAdd[i]).trigger('add', model, this, options);
      }

      // Trigger `sort` if the collection was sorted.
      if (sort) this.trigger('sort', this, options);
      return this;
    },

    // When you have more items than you want to add or remove individually,
    // you can reset the entire set with a new list of models, without firing
    // any granular `add` or `remove` events. Fires `reset` when finished.
    // Useful for bulk operations and optimizations.
    reset: function(models, options) {
      options || (options = {});
      for (var i = 0, l = this.models.length; i < l; i++) {
        this._removeReference(this.models[i]);
      }
      options.previousModels = this.models;
      this._reset();
      this.add(models, _.extend({silent: true}, options));
      if (!options.silent) this.trigger('reset', this, options);
      return this;
    },

    // Add a model to the end of the collection.
    push: function(model, options) {
      model = this._prepareModel(model, options);
      this.add(model, _.extend({at: this.length}, options));
      return model;
    },

    // Remove a model from the end of the collection.
    pop: function(options) {
      var model = this.at(this.length - 1);
      this.remove(model, options);
      return model;
    },

    // Add a model to the beginning of the collection.
    unshift: function(model, options) {
      model = this._prepareModel(model, options);
      this.add(model, _.extend({at: 0}, options));
      return model;
    },

    // Remove a model from the beginning of the collection.
    shift: function(options) {
      var model = this.at(0);
      this.remove(model, options);
      return model;
    },

    // Slice out a sub-array of models from the collection.
    slice: function(begin, end) {
      return this.models.slice(begin, end);
    },

    // Get a model from the set by id.
    get: function(obj) {
      if (obj == null) return void 0;
      return this._byId[obj.id != null ? obj.id : obj.cid || obj];
    },

    // Get the model at the given index.
    at: function(index) {
      return this.models[index];
    },

    // Return models with matching attributes. Useful for simple cases of
    // `filter`.
    where: function(attrs, first) {
      if (_.isEmpty(attrs)) return first ? void 0 : [];
      return this[first ? 'find' : 'filter'](function(model) {
        for (var key in attrs) {
          if (attrs[key] !== model.get(key)) return false;
        }
        return true;
      });
    },

    // Return the first model with matching attributes. Useful for simple cases
    // of `find`.
    findWhere: function(attrs) {
      return this.where(attrs, true);
    },

    // Force the collection to re-sort itself. You don't need to call this under
    // normal circumstances, as the set will maintain sort order as each item
    // is added.
    sort: function(options) {
      if (!this.comparator) throw new Error('Cannot sort a set without a comparator');
      options || (options = {});

      // Run sort based on type of `comparator`.
      if (_.isString(this.comparator) || this.comparator.length === 1) {
        this.models = this.sortBy(this.comparator, this);
      } else {
        this.models.sort(_.bind(this.comparator, this));
      }

      if (!options.silent) this.trigger('sort', this, options);
      return this;
    },

    // Figure out the smallest index at which a model should be inserted so as
    // to maintain order.
    sortedIndex: function(model, value, context) {
      value || (value = this.comparator);
      var iterator = _.isFunction(value) ? value : function(model) {
        return model.get(value);
      };
      return _.sortedIndex(this.models, model, iterator, context);
    },

    // Pluck an attribute from each model in the collection.
    pluck: function(attr) {
      return _.invoke(this.models, 'get', attr);
    },

    // Fetch the default set of models for this collection, resetting the
    // collection when they arrive. If `reset: true` is passed, the response
    // data will be passed through the `reset` method instead of `set`.
    fetch: function(options) {
      options = options ? _.clone(options) : {};
      if (options.parse === void 0) options.parse = true;
      var success = options.success;
      var collection = this;
      options.success = function(resp) {
        var method = options.reset ? 'reset' : 'set';
        collection[method](resp, options);
        if (success) success(collection, resp, options);
        collection.trigger('sync', collection, resp, options);
      };
      wrapError(this, options);
      return this.sync('read', this, options);
    },

    // Create a new instance of a model in this collection. Add the model to the
    // collection immediately, unless `wait: true` is passed, in which case we
    // wait for the server to agree.
    create: function(model, options) {
      options = options ? _.clone(options) : {};
      if (!(model = this._prepareModel(model, options))) return false;
      if (!options.wait) this.add(model, options);
      var collection = this;
      var success = options.success;
      options.success = function(resp) {
        if (options.wait) collection.add(model, options);
        if (success) success(model, resp, options);
      };
      model.save(null, options);
      return model;
    },

    // **parse** converts a response into a list of models to be added to the
    // collection. The default implementation is just to pass it through.
    parse: function(resp, options) {
      return resp;
    },

    // Create a new collection with an identical list of models as this one.
    clone: function() {
      return new this.constructor(this.models);
    },

    // Private method to reset all internal state. Called when the collection
    // is first initialized or reset.
    _reset: function() {
      this.length = 0;
      this.models = [];
      this._byId  = {};
    },

    // Prepare a hash of attributes (or other model) to be added to this
    // collection.
    _prepareModel: function(attrs, options) {
      if (attrs instanceof Model) {
        if (!attrs.collection) attrs.collection = this;
        return attrs;
      }
      options || (options = {});
      options.collection = this;
      var model = new this.model(attrs, options);
      if (!model._validate(attrs, options)) {
        this.trigger('invalid', this, attrs, options);
        return false;
      }
      return model;
    },

    // Internal method to sever a model's ties to a collection.
    _removeReference: function(model) {
      if (this === model.collection) delete model.collection;
      model.off('all', this._onModelEvent, this);
    },

    // Internal method called every time a model in the set fires an event.
    // Sets need to update their indexes when models change ids. All other
    // events simply proxy through. "add" and "remove" events that originate
    // in other collections are ignored.
    _onModelEvent: function(event, model, collection, options) {
      if ((event === 'add' || event === 'remove') && collection !== this) return;
      if (event === 'destroy') this.remove(model, options);
      if (model && event === 'change:' + model.idAttribute) {
        delete this._byId[model.previous(model.idAttribute)];
        if (model.id != null) this._byId[model.id] = model;
      }
      this.trigger.apply(this, arguments);
    }

  });

  // Underscore methods that we want to implement on the Collection.
  // 90% of the core usefulness of Backbone Collections is actually implemented
  // right here:
  var methods = ['forEach', 'each', 'map', 'collect', 'reduce', 'foldl',
    'inject', 'reduceRight', 'foldr', 'find', 'detect', 'filter', 'select',
    'reject', 'every', 'all', 'some', 'any', 'include', 'contains', 'invoke',
    'max', 'min', 'toArray', 'size', 'first', 'head', 'take', 'initial', 'rest',
    'tail', 'drop', 'last', 'without', 'indexOf', 'shuffle', 'lastIndexOf',
    'isEmpty', 'chain'];

  // Mix in each Underscore method as a proxy to `Collection#models`.
  _.each(methods, function(method) {
    Collection.prototype[method] = function() {
      var args = slice.call(arguments);
      args.unshift(this.models);
      return _[method].apply(_, args);
    };
  });

  // Underscore methods that take a property name as an argument.
  var attributeMethods = ['groupBy', 'countBy', 'sortBy'];

  // Use attributes instead of properties.
  _.each(attributeMethods, function(method) {
    Collection.prototype[method] = function(value, context) {
      var iterator = _.isFunction(value) ? value : function(model) {
        return model.get(value);
      };
      return _[method](this.models, iterator, context);
    };
  });

  // Backbone.View
  // -------------

  // Backbone Views are almost more convention than they are actual code. A View
  // is simply a JavaScript object that represents a logical chunk of UI in the
  // DOM. This might be a single item, an entire list, a sidebar or panel, or
  // even the surrounding frame which wraps your whole app. Defining a chunk of
  // UI as a **View** allows you to define your DOM events declaratively, without
  // having to worry about render order ... and makes it easy for the view to
  // react to specific changes in the state of your models.

  // Creating a Backbone.View creates its initial element outside of the DOM,
  // if an existing element is not provided...
  var View = Backbone.View = function(options) {
    this.cid = _.uniqueId('view');
    this._configure(options || {});
    this._ensureElement();
    this.initialize.apply(this, arguments);
    this.delegateEvents();
  };

  // Cached regex to split keys for `delegate`.
  var delegateEventSplitter = /^(\S+)\s*(.*)$/;

  // List of view options to be merged as properties.
  var viewOptions = ['model', 'collection', 'el', 'id', 'attributes', 'className', 'tagName', 'events'];

  // Set up all inheritable **Backbone.View** properties and methods.
  _.extend(View.prototype, Events, {

    // The default `tagName` of a View's element is `"div"`.
    tagName: 'div',

    // jQuery delegate for element lookup, scoped to DOM elements within the
    // current view. This should be prefered to global lookups where possible.
    $: function(selector) {
      return this.$el.find(selector);
    },

    // Initialize is an empty function by default. Override it with your own
    // initialization logic.
    initialize: function(){},

    // **render** is the core function that your view should override, in order
    // to populate its element (`this.el`), with the appropriate HTML. The
    // convention is for **render** to always return `this`.
    render: function() {
      return this;
    },

    // Remove this view by taking the element out of the DOM, and removing any
    // applicable Backbone.Events listeners.
    remove: function() {
      this.$el.remove();
      this.stopListening();
      return this;
    },

    // Change the view's element (`this.el` property), including event
    // re-delegation.
    setElement: function(element, delegate) {
      if (this.$el) this.undelegateEvents();
      this.$el = element instanceof Backbone.$ ? element : Backbone.$(element);
      this.el = this.$el[0];
      if (delegate !== false) this.delegateEvents();
      return this;
    },

    // Set callbacks, where `this.events` is a hash of
    //
    // *{"event selector": "callback"}*
    //
    //     {
    //       'mousedown .title':  'edit',
    //       'click .button':     'save'
    //       'click .open':       function(e) { ... }
    //     }
    //
    // pairs. Callbacks will be bound to the view, with `this` set properly.
    // Uses event delegation for efficiency.
    // Omitting the selector binds the event to `this.el`.
    // This only works for delegate-able events: not `focus`, `blur`, and
    // not `change`, `submit`, and `reset` in Internet Explorer.
    delegateEvents: function(events) {
      if (!(events || (events = _.result(this, 'events')))) return this;
      this.undelegateEvents();
      for (var key in events) {
        var method = events[key];
        if (!_.isFunction(method)) method = this[events[key]];
        if (!method) continue;

        var match = key.match(delegateEventSplitter);
        var eventName = match[1], selector = match[2];
        method = _.bind(method, this);
        eventName += '.delegateEvents' + this.cid;
        if (selector === '') {
          this.$el.on(eventName, method);
        } else {
          this.$el.on(eventName, selector, method);
        }
      }
      return this;
    },

    // Clears all callbacks previously bound to the view with `delegateEvents`.
    // You usually don't need to use this, but may wish to if you have multiple
    // Backbone views attached to the same DOM element.
    undelegateEvents: function() {
      this.$el.off('.delegateEvents' + this.cid);
      return this;
    },

    // Performs the initial configuration of a View with a set of options.
    // Keys with special meaning *(e.g. model, collection, id, className)* are
    // attached directly to the view.  See `viewOptions` for an exhaustive
    // list.
    _configure: function(options) {
      if (this.options) options = _.extend({}, _.result(this, 'options'), options);
      _.extend(this, _.pick(options, viewOptions));
      this.options = options;
    },

    // Ensure that the View has a DOM element to render into.
    // If `this.el` is a string, pass it through `$()`, take the first
    // matching element, and re-assign it to `el`. Otherwise, create
    // an element from the `id`, `className` and `tagName` properties.
    _ensureElement: function() {
      if (!this.el) {
        var attrs = _.extend({}, _.result(this, 'attributes'));
        if (this.id) attrs.id = _.result(this, 'id');
        if (this.className) attrs['class'] = _.result(this, 'className');
        var $el = Backbone.$('<' + _.result(this, 'tagName') + '>').attr(attrs);
        this.setElement($el, false);
      } else {
        this.setElement(_.result(this, 'el'), false);
      }
    }

  });

  // Backbone.sync
  // -------------

  // Override this function to change the manner in which Backbone persists
  // models to the server. You will be passed the type of request, and the
  // model in question. By default, makes a RESTful Ajax request
  // to the model's `url()`. Some possible customizations could be:
  //
  // * Use `setTimeout` to batch rapid-fire updates into a single request.
  // * Send up the models as XML instead of JSON.
  // * Persist models via WebSockets instead of Ajax.
  //
  // Turn on `Backbone.emulateHTTP` in order to send `PUT` and `DELETE` requests
  // as `POST`, with a `_method` parameter containing the true HTTP method,
  // as well as all requests with the body as `application/x-www-form-urlencoded`
  // instead of `application/json` with the model in a param named `model`.
  // Useful when interfacing with server-side languages like **PHP** that make
  // it difficult to read the body of `PUT` requests.
  Backbone.sync = function(method, model, options) {
    var type = methodMap[method];

    // Default options, unless specified.
    _.defaults(options || (options = {}), {
      emulateHTTP: Backbone.emulateHTTP,
      emulateJSON: Backbone.emulateJSON
    });

    // Default JSON-request options.
    var params = {type: type, dataType: 'json'};

    // Ensure that we have a URL.
    if (!options.url) {
      params.url = _.result(model, 'url') || urlError();
    }

    // Ensure that we have the appropriate request data.
    if (options.data == null && model && (method === 'create' || method === 'update' || method === 'patch')) {
      params.contentType = 'application/json';
      params.data = JSON.stringify(options.attrs || model.toJSON(options));
    }

    // For older servers, emulate JSON by encoding the request into an HTML-form.
    if (options.emulateJSON) {
      params.contentType = 'application/x-www-form-urlencoded';
      params.data = params.data ? {model: params.data} : {};
    }

    // For older servers, emulate HTTP by mimicking the HTTP method with `_method`
    // And an `X-HTTP-Method-Override` header.
    if (options.emulateHTTP && (type === 'PUT' || type === 'DELETE' || type === 'PATCH')) {
      params.type = 'POST';
      if (options.emulateJSON) params.data._method = type;
      var beforeSend = options.beforeSend;
      options.beforeSend = function(xhr) {
        xhr.setRequestHeader('X-HTTP-Method-Override', type);
        if (beforeSend) return beforeSend.apply(this, arguments);
      };
    }

    // Don't process data on a non-GET request.
    if (params.type !== 'GET' && !options.emulateJSON) {
      params.processData = false;
    }

    // If we're sending a `PATCH` request, and we're in an old Internet Explorer
    // that still has ActiveX enabled by default, override jQuery to use that
    // for XHR instead. Remove this line when jQuery supports `PATCH` on IE8.
    if (params.type === 'PATCH' && window.ActiveXObject &&
          !(window.external && window.external.msActiveXFilteringEnabled)) {
      params.xhr = function() {
        return new ActiveXObject("Microsoft.XMLHTTP");
      };
    }

    // Make the request, allowing the user to override any Ajax options.
    var xhr = options.xhr = Backbone.ajax(_.extend(params, options));
    model.trigger('request', model, xhr, options);
    return xhr;
  };

  // Map from CRUD to HTTP for our default `Backbone.sync` implementation.
  var methodMap = {
    'create': 'POST',
    'update': 'PUT',
    'patch':  'PATCH',
    'delete': 'DELETE',
    'read':   'GET'
  };

  // Set the default implementation of `Backbone.ajax` to proxy through to `$`.
  // Override this if you'd like to use a different library.
  Backbone.ajax = function() {
    return Backbone.$.ajax.apply(Backbone.$, arguments);
  };

  // Backbone.Router
  // ---------------

  // Routers map faux-URLs to actions, and fire events when routes are
  // matched. Creating a new one sets its `routes` hash, if not set statically.
  var Router = Backbone.Router = function(options) {
    options || (options = {});
    if (options.routes) this.routes = options.routes;
    this._bindRoutes();
    this.initialize.apply(this, arguments);
  };

  // Cached regular expressions for matching named param parts and splatted
  // parts of route strings.
  var optionalParam = /\((.*?)\)/g;
  var namedParam    = /(\(\?)?:\w+/g;
  var splatParam    = /\*\w+/g;
  var escapeRegExp  = /[\-{}\[\]+?.,\\\^$|#\s]/g;

  // Set up all inheritable **Backbone.Router** properties and methods.
  _.extend(Router.prototype, Events, {

    // Initialize is an empty function by default. Override it with your own
    // initialization logic.
    initialize: function(){},

    // Manually bind a single named route to a callback. For example:
    //
    //     this.route('search/:query/p:num', 'search', function(query, num) {
    //       ...
    //     });
    //
    route: function(route, name, callback) {
      if (!_.isRegExp(route)) route = this._routeToRegExp(route);
      if (_.isFunction(name)) {
        callback = name;
        name = '';
      }
      if (!callback) callback = this[name];
      var router = this;
      Backbone.history.route(route, function(fragment) {
        var args = router._extractParameters(route, fragment);
        callback && callback.apply(router, args);
        router.trigger.apply(router, ['route:' + name].concat(args));
        router.trigger('route', name, args);
        Backbone.history.trigger('route', router, name, args);
      });
      return this;
    },

    // Simple proxy to `Backbone.history` to save a fragment into the history.
    navigate: function(fragment, options) {
      Backbone.history.navigate(fragment, options);
      return this;
    },

    // Bind all defined routes to `Backbone.history`. We have to reverse the
    // order of the routes here to support behavior where the most general
    // routes can be defined at the bottom of the route map.
    _bindRoutes: function() {
      if (!this.routes) return;
      this.routes = _.result(this, 'routes');
      var route, routes = _.keys(this.routes);
      while ((route = routes.pop()) != null) {
        this.route(route, this.routes[route]);
      }
    },

    // Convert a route string into a regular expression, suitable for matching
    // against the current location hash.
    _routeToRegExp: function(route) {
      route = route.replace(escapeRegExp, '\\$&')
                   .replace(optionalParam, '(?:$1)?')
                   .replace(namedParam, function(match, optional){
                     return optional ? match : '([^\/]+)';
                   })
                   .replace(splatParam, '(.*?)');
      return new RegExp('^' + route + '$');
    },

    // Given a route, and a URL fragment that it matches, return the array of
    // extracted decoded parameters. Empty or unmatched parameters will be
    // treated as `null` to normalize cross-browser behavior.
    _extractParameters: function(route, fragment) {
      var params = route.exec(fragment).slice(1);
      return _.map(params, function(param) {
        return param ? decodeURIComponent(param) : null;
      });
    }

  });

  // Backbone.History
  // ----------------

  // Handles cross-browser history management, based on either
  // [pushState](http://diveintohtml5.info/history.html) and real URLs, or
  // [onhashchange](https://developer.mozilla.org/en-US/docs/DOM/window.onhashchange)
  // and URL fragments. If the browser supports neither (old IE, natch),
  // falls back to polling.
  var History = Backbone.History = function() {
    this.handlers = [];
    _.bindAll(this, 'checkUrl');

    // Ensure that `History` can be used outside of the browser.
    if (typeof window !== 'undefined') {
      this.location = window.location;
      this.history = window.history;
    }
  };

  // Cached regex for stripping a leading hash/slash and trailing space.
  var routeStripper = /^[#\/]|\s+$/g;

  // Cached regex for stripping leading and trailing slashes.
  var rootStripper = /^\/+|\/+$/g;

  // Cached regex for detecting MSIE.
  var isExplorer = /msie [\w.]+/;

  // Cached regex for removing a trailing slash.
  var trailingSlash = /\/$/;

  // Has the history handling already been started?
  History.started = false;

  // Set up all inheritable **Backbone.History** properties and methods.
  _.extend(History.prototype, Events, {

    // The default interval to poll for hash changes, if necessary, is
    // twenty times a second.
    interval: 50,

    // Gets the true hash value. Cannot use location.hash directly due to bug
    // in Firefox where location.hash will always be decoded.
    getHash: function(window) {
      var match = (window || this).location.href.match(/#(.*)$/);
      return match ? match[1] : '';
    },

    // Get the cross-browser normalized URL fragment, either from the URL,
    // the hash, or the override.
    getFragment: function(fragment, forcePushState) {
      if (fragment == null) {
        if (this._hasPushState || !this._wantsHashChange || forcePushState) {
          fragment = this.location.pathname;
          var root = this.root.replace(trailingSlash, '');
          if (!fragment.indexOf(root)) fragment = fragment.substr(root.length);
        } else {
          fragment = this.getHash();
        }
      }
      return fragment.replace(routeStripper, '');
    },

    // Start the hash change handling, returning `true` if the current URL matches
    // an existing route, and `false` otherwise.
    start: function(options) {
      if (History.started) throw new Error("Backbone.history has already been started");
      History.started = true;

      // Figure out the initial configuration. Do we need an iframe?
      // Is pushState desired ... is it available?
      this.options          = _.extend({}, {root: '/'}, this.options, options);
      this.root             = this.options.root;
      this._wantsHashChange = this.options.hashChange !== false;
      this._wantsPushState  = !!this.options.pushState;
      this._hasPushState    = !!(this.options.pushState && this.history && this.history.pushState);
      var fragment          = this.getFragment();
      var docMode           = document.documentMode;
      var oldIE             = (isExplorer.exec(navigator.userAgent.toLowerCase()) && (!docMode || docMode <= 7));

      // Normalize root to always include a leading and trailing slash.
      this.root = ('/' + this.root + '/').replace(rootStripper, '/');

      if (oldIE && this._wantsHashChange) {
        this.iframe = Backbone.$('<iframe src="javascript:0" tabindex="-1" />').hide().appendTo('body')[0].contentWindow;
        this.navigate(fragment);
      }

      // Depending on whether we're using pushState or hashes, and whether
      // 'onhashchange' is supported, determine how we check the URL state.
      if (this._hasPushState) {
        Backbone.$(window).on('popstate', this.checkUrl);
      } else if (this._wantsHashChange && ('onhashchange' in window) && !oldIE) {
        Backbone.$(window).on('hashchange', this.checkUrl);
      } else if (this._wantsHashChange) {
        this._checkUrlInterval = setInterval(this.checkUrl, this.interval);
      }

      // Determine if we need to change the base url, for a pushState link
      // opened by a non-pushState browser.
      this.fragment = fragment;
      var loc = this.location;
      var atRoot = loc.pathname.replace(/[^\/]$/, '$&/') === this.root;

      // If we've started off with a route from a `pushState`-enabled browser,
      // but we're currently in a browser that doesn't support it...
      if (this._wantsHashChange && this._wantsPushState && !this._hasPushState && !atRoot) {
        this.fragment = this.getFragment(null, true);
        this.location.replace(this.root + this.location.search + '#' + this.fragment);
        // Return immediately as browser will do redirect to new url
        return true;

      // Or if we've started out with a hash-based route, but we're currently
      // in a browser where it could be `pushState`-based instead...
      } else if (this._wantsPushState && this._hasPushState && atRoot && loc.hash) {
        this.fragment = this.getHash().replace(routeStripper, '');
        this.history.replaceState({}, document.title, this.root + this.fragment + loc.search);
      }

      if (!this.options.silent) return this.loadUrl();
    },

    // Disable Backbone.history, perhaps temporarily. Not useful in a real app,
    // but possibly useful for unit testing Routers.
    stop: function() {
      Backbone.$(window).off('popstate', this.checkUrl).off('hashchange', this.checkUrl);
      clearInterval(this._checkUrlInterval);
      History.started = false;
    },

    // Add a route to be tested when the fragment changes. Routes added later
    // may override previous routes.
    route: function(route, callback) {
      this.handlers.unshift({route: route, callback: callback});
    },

    // Checks the current URL to see if it has changed, and if it has,
    // calls `loadUrl`, normalizing across the hidden iframe.
    checkUrl: function(e) {
      var current = this.getFragment();
      if (current === this.fragment && this.iframe) {
        current = this.getFragment(this.getHash(this.iframe));
      }
      if (current === this.fragment) return false;
      if (this.iframe) this.navigate(current);
      this.loadUrl() || this.loadUrl(this.getHash());
    },

    // Attempt to load the current URL fragment. If a route succeeds with a
    // match, returns `true`. If no defined routes matches the fragment,
    // returns `false`.
    loadUrl: function(fragmentOverride) {
      var fragment = this.fragment = this.getFragment(fragmentOverride);
      var matched = _.any(this.handlers, function(handler) {
        if (handler.route.test(fragment)) {
          handler.callback(fragment);
          return true;
        }
      });
      return matched;
    },

    // Save a fragment into the hash history, or replace the URL state if the
    // 'replace' option is passed. You are responsible for properly URL-encoding
    // the fragment in advance.
    //
    // The options object can contain `trigger: true` if you wish to have the
    // route callback be fired (not usually desirable), or `replace: true`, if
    // you wish to modify the current URL without adding an entry to the history.
    navigate: function(fragment, options) {
      if (!History.started) return false;
      if (!options || options === true) options = {trigger: options};
      fragment = this.getFragment(fragment || '');
      if (this.fragment === fragment) return;
      this.fragment = fragment;
      var url = this.root + fragment;

      // If pushState is available, we use it to set the fragment as a real URL.
      if (this._hasPushState) {
        this.history[options.replace ? 'replaceState' : 'pushState']({}, document.title, url);

      // If hash changes haven't been explicitly disabled, update the hash
      // fragment to store history.
      } else if (this._wantsHashChange) {
        this._updateHash(this.location, fragment, options.replace);
        if (this.iframe && (fragment !== this.getFragment(this.getHash(this.iframe)))) {
          // Opening and closing the iframe tricks IE7 and earlier to push a
          // history entry on hash-tag change.  When replace is true, we don't
          // want this.
          if(!options.replace) this.iframe.document.open().close();
          this._updateHash(this.iframe.location, fragment, options.replace);
        }

      // If you've told us that you explicitly don't want fallback hashchange-
      // based history, then `navigate` becomes a page refresh.
      } else {
        return this.location.assign(url);
      }
      if (options.trigger) this.loadUrl(fragment);
    },

    // Update the hash location, either replacing the current entry, or adding
    // a new one to the browser history.
    _updateHash: function(location, fragment, replace) {
      if (replace) {
        var href = location.href.replace(/(javascript:|#).*$/, '');
        location.replace(href + '#' + fragment);
      } else {
        // Some browsers require that `hash` contains a leading #.
        location.hash = '#' + fragment;
      }
    }

  });

  // Create the default Backbone.history.
  Backbone.history = new History;

  // Helpers
  // -------

  // Helper function to correctly set up the prototype chain, for subclasses.
  // Similar to `goog.inherits`, but uses a hash of prototype properties and
  // class properties to be extended.
  var extend = function(protoProps, staticProps) {
    var parent = this;
    var child;

    // The constructor function for the new subclass is either defined by you
    // (the "constructor" property in your `extend` definition), or defaulted
    // by us to simply call the parent's constructor.
    if (protoProps && _.has(protoProps, 'constructor')) {
      child = protoProps.constructor;
    } else {
      child = function(){ return parent.apply(this, arguments); };
    }

    // Add static properties to the constructor function, if supplied.
    _.extend(child, parent, staticProps);

    // Set the prototype chain to inherit from `parent`, without calling
    // `parent`'s constructor function.
    var Surrogate = function(){ this.constructor = child; };
    Surrogate.prototype = parent.prototype;
    child.prototype = new Surrogate;

    // Add prototype properties (instance properties) to the subclass,
    // if supplied.
    if (protoProps) _.extend(child.prototype, protoProps);

    // Set a convenience property in case the parent's prototype is needed
    // later.
    child.__super__ = parent.prototype;

    return child;
  };

  // Set up inheritance for the model, collection, router, view and history.
  Model.extend = Collection.extend = Router.extend = View.extend = History.extend = extend;

  // Throw an error when a URL is needed, and none is supplied.
  var urlError = function() {
    throw new Error('A "url" property or function must be specified');
  };

  // Wrap an optional error callback with a fallback error event.
  var wrapError = function (model, options) {
    var error = options.error;
    options.error = function(resp) {
      if (error) error(model, resp, options);
      model.trigger('error', model, resp, options);
    };
  };

}).call(this);

define("backbone", ["jquery","underscore"], (function (global) {
    return function () {
        var ret, fn;
        return ret || global.Backbone;
    };
}(this)));

define('cs',{load: function(id){throw new Error("Dynamic load not allowed: " + id);}});
/*

Copyright (C) 2011 by Yehuda Katz

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

*/

// lib/handlebars/browser-prefix.js
var Handlebars = {};

(function(Handlebars, undefined) {
;
// lib/handlebars/base.js

Handlebars.VERSION = "1.0.0";
Handlebars.COMPILER_REVISION = 4;

Handlebars.REVISION_CHANGES = {
  1: '<= 1.0.rc.2', // 1.0.rc.2 is actually rev2 but doesn't report it
  2: '== 1.0.0-rc.3',
  3: '== 1.0.0-rc.4',
  4: '>= 1.0.0'
};

Handlebars.helpers  = {};
Handlebars.partials = {};

var toString = Object.prototype.toString,
    functionType = '[object Function]',
    objectType = '[object Object]';

Handlebars.registerHelper = function(name, fn, inverse) {
  if (toString.call(name) === objectType) {
    if (inverse || fn) { throw new Handlebars.Exception('Arg not supported with multiple helpers'); }
    Handlebars.Utils.extend(this.helpers, name);
  } else {
    if (inverse) { fn.not = inverse; }
    this.helpers[name] = fn;
  }
};

Handlebars.registerPartial = function(name, str) {
  if (toString.call(name) === objectType) {
    Handlebars.Utils.extend(this.partials,  name);
  } else {
    this.partials[name] = str;
  }
};

Handlebars.registerHelper('helperMissing', function(arg) {
  if(arguments.length === 2) {
    return undefined;
  } else {
    throw new Error("Missing helper: '" + arg + "'");
  }
});

Handlebars.registerHelper('blockHelperMissing', function(context, options) {
  var inverse = options.inverse || function() {}, fn = options.fn;

  var type = toString.call(context);

  if(type === functionType) { context = context.call(this); }

  if(context === true) {
    return fn(this);
  } else if(context === false || context == null) {
    return inverse(this);
  } else if(type === "[object Array]") {
    if(context.length > 0) {
      return Handlebars.helpers.each(context, options);
    } else {
      return inverse(this);
    }
  } else {
    return fn(context);
  }
});

Handlebars.K = function() {};

Handlebars.createFrame = Object.create || function(object) {
  Handlebars.K.prototype = object;
  var obj = new Handlebars.K();
  Handlebars.K.prototype = null;
  return obj;
};

Handlebars.logger = {
  DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, level: 3,

  methodMap: {0: 'debug', 1: 'info', 2: 'warn', 3: 'error'},

  // can be overridden in the host environment
  log: function(level, obj) {
    if (Handlebars.logger.level <= level) {
      var method = Handlebars.logger.methodMap[level];
      if (typeof console !== 'undefined' && console[method]) {
        console[method].call(console, obj);
      }
    }
  }
};

Handlebars.log = function(level, obj) { Handlebars.logger.log(level, obj); };

Handlebars.registerHelper('each', function(context, options) {
  var fn = options.fn, inverse = options.inverse;
  var i = 0, ret = "", data;

  var type = toString.call(context);
  if(type === functionType) { context = context.call(this); }

  if (options.data) {
    data = Handlebars.createFrame(options.data);
  }

  if(context && typeof context === 'object') {
    if(context instanceof Array){
      for(var j = context.length; i<j; i++) {
        if (data) { data.index = i; }
        ret = ret + fn(context[i], { data: data });
      }
    } else {
      for(var key in context) {
        if(context.hasOwnProperty(key)) {
          if(data) { data.key = key; }
          ret = ret + fn(context[key], {data: data});
          i++;
        }
      }
    }
  }

  if(i === 0){
    ret = inverse(this);
  }

  return ret;
});

Handlebars.registerHelper('if', function(conditional, options) {
  var type = toString.call(conditional);
  if(type === functionType) { conditional = conditional.call(this); }

  if(!conditional || Handlebars.Utils.isEmpty(conditional)) {
    return options.inverse(this);
  } else {
    return options.fn(this);
  }
});

Handlebars.registerHelper('unless', function(conditional, options) {
  return Handlebars.helpers['if'].call(this, conditional, {fn: options.inverse, inverse: options.fn});
});

Handlebars.registerHelper('with', function(context, options) {
  var type = toString.call(context);
  if(type === functionType) { context = context.call(this); }

  if (!Handlebars.Utils.isEmpty(context)) return options.fn(context);
});

Handlebars.registerHelper('log', function(context, options) {
  var level = options.data && options.data.level != null ? parseInt(options.data.level, 10) : 1;
  Handlebars.log(level, context);
});
;
// lib/handlebars/compiler/parser.js
/* Jison generated parser */
var handlebars = (function(){
var parser = {trace: function trace() { },
yy: {},
symbols_: {"error":2,"root":3,"program":4,"EOF":5,"simpleInverse":6,"statements":7,"statement":8,"openInverse":9,"closeBlock":10,"openBlock":11,"mustache":12,"partial":13,"CONTENT":14,"COMMENT":15,"OPEN_BLOCK":16,"inMustache":17,"CLOSE":18,"OPEN_INVERSE":19,"OPEN_ENDBLOCK":20,"path":21,"OPEN":22,"OPEN_UNESCAPED":23,"CLOSE_UNESCAPED":24,"OPEN_PARTIAL":25,"partialName":26,"params":27,"hash":28,"dataName":29,"param":30,"STRING":31,"INTEGER":32,"BOOLEAN":33,"hashSegments":34,"hashSegment":35,"ID":36,"EQUALS":37,"DATA":38,"pathSegments":39,"SEP":40,"$accept":0,"$end":1},
terminals_: {2:"error",5:"EOF",14:"CONTENT",15:"COMMENT",16:"OPEN_BLOCK",18:"CLOSE",19:"OPEN_INVERSE",20:"OPEN_ENDBLOCK",22:"OPEN",23:"OPEN_UNESCAPED",24:"CLOSE_UNESCAPED",25:"OPEN_PARTIAL",31:"STRING",32:"INTEGER",33:"BOOLEAN",36:"ID",37:"EQUALS",38:"DATA",40:"SEP"},
productions_: [0,[3,2],[4,2],[4,3],[4,2],[4,1],[4,1],[4,0],[7,1],[7,2],[8,3],[8,3],[8,1],[8,1],[8,1],[8,1],[11,3],[9,3],[10,3],[12,3],[12,3],[13,3],[13,4],[6,2],[17,3],[17,2],[17,2],[17,1],[17,1],[27,2],[27,1],[30,1],[30,1],[30,1],[30,1],[30,1],[28,1],[34,2],[34,1],[35,3],[35,3],[35,3],[35,3],[35,3],[26,1],[26,1],[26,1],[29,2],[21,1],[39,3],[39,1]],
performAction: function anonymous(yytext,yyleng,yylineno,yy,yystate,$$,_$) {

var $0 = $$.length - 1;
switch (yystate) {
case 1: return $$[$0-1]; 
break;
case 2: this.$ = new yy.ProgramNode([], $$[$0]); 
break;
case 3: this.$ = new yy.ProgramNode($$[$0-2], $$[$0]); 
break;
case 4: this.$ = new yy.ProgramNode($$[$0-1], []); 
break;
case 5: this.$ = new yy.ProgramNode($$[$0]); 
break;
case 6: this.$ = new yy.ProgramNode([], []); 
break;
case 7: this.$ = new yy.ProgramNode([]); 
break;
case 8: this.$ = [$$[$0]]; 
break;
case 9: $$[$0-1].push($$[$0]); this.$ = $$[$0-1]; 
break;
case 10: this.$ = new yy.BlockNode($$[$0-2], $$[$0-1].inverse, $$[$0-1], $$[$0]); 
break;
case 11: this.$ = new yy.BlockNode($$[$0-2], $$[$0-1], $$[$0-1].inverse, $$[$0]); 
break;
case 12: this.$ = $$[$0]; 
break;
case 13: this.$ = $$[$0]; 
break;
case 14: this.$ = new yy.ContentNode($$[$0]); 
break;
case 15: this.$ = new yy.CommentNode($$[$0]); 
break;
case 16: this.$ = new yy.MustacheNode($$[$0-1][0], $$[$0-1][1]); 
break;
case 17: this.$ = new yy.MustacheNode($$[$0-1][0], $$[$0-1][1]); 
break;
case 18: this.$ = $$[$0-1]; 
break;
case 19:
    // Parsing out the '&' escape token at this level saves ~500 bytes after min due to the removal of one parser node.
    this.$ = new yy.MustacheNode($$[$0-1][0], $$[$0-1][1], $$[$0-2][2] === '&');
  
break;
case 20: this.$ = new yy.MustacheNode($$[$0-1][0], $$[$0-1][1], true); 
break;
case 21: this.$ = new yy.PartialNode($$[$0-1]); 
break;
case 22: this.$ = new yy.PartialNode($$[$0-2], $$[$0-1]); 
break;
case 23: 
break;
case 24: this.$ = [[$$[$0-2]].concat($$[$0-1]), $$[$0]]; 
break;
case 25: this.$ = [[$$[$0-1]].concat($$[$0]), null]; 
break;
case 26: this.$ = [[$$[$0-1]], $$[$0]]; 
break;
case 27: this.$ = [[$$[$0]], null]; 
break;
case 28: this.$ = [[$$[$0]], null]; 
break;
case 29: $$[$0-1].push($$[$0]); this.$ = $$[$0-1]; 
break;
case 30: this.$ = [$$[$0]]; 
break;
case 31: this.$ = $$[$0]; 
break;
case 32: this.$ = new yy.StringNode($$[$0]); 
break;
case 33: this.$ = new yy.IntegerNode($$[$0]); 
break;
case 34: this.$ = new yy.BooleanNode($$[$0]); 
break;
case 35: this.$ = $$[$0]; 
break;
case 36: this.$ = new yy.HashNode($$[$0]); 
break;
case 37: $$[$0-1].push($$[$0]); this.$ = $$[$0-1]; 
break;
case 38: this.$ = [$$[$0]]; 
break;
case 39: this.$ = [$$[$0-2], $$[$0]]; 
break;
case 40: this.$ = [$$[$0-2], new yy.StringNode($$[$0])]; 
break;
case 41: this.$ = [$$[$0-2], new yy.IntegerNode($$[$0])]; 
break;
case 42: this.$ = [$$[$0-2], new yy.BooleanNode($$[$0])]; 
break;
case 43: this.$ = [$$[$0-2], $$[$0]]; 
break;
case 44: this.$ = new yy.PartialNameNode($$[$0]); 
break;
case 45: this.$ = new yy.PartialNameNode(new yy.StringNode($$[$0])); 
break;
case 46: this.$ = new yy.PartialNameNode(new yy.IntegerNode($$[$0])); 
break;
case 47: this.$ = new yy.DataNode($$[$0]); 
break;
case 48: this.$ = new yy.IdNode($$[$0]); 
break;
case 49: $$[$0-2].push({part: $$[$0], separator: $$[$0-1]}); this.$ = $$[$0-2]; 
break;
case 50: this.$ = [{part: $$[$0]}]; 
break;
}
},
table: [{3:1,4:2,5:[2,7],6:3,7:4,8:6,9:7,11:8,12:9,13:10,14:[1,11],15:[1,12],16:[1,13],19:[1,5],22:[1,14],23:[1,15],25:[1,16]},{1:[3]},{5:[1,17]},{5:[2,6],7:18,8:6,9:7,11:8,12:9,13:10,14:[1,11],15:[1,12],16:[1,13],19:[1,19],20:[2,6],22:[1,14],23:[1,15],25:[1,16]},{5:[2,5],6:20,8:21,9:7,11:8,12:9,13:10,14:[1,11],15:[1,12],16:[1,13],19:[1,5],20:[2,5],22:[1,14],23:[1,15],25:[1,16]},{17:23,18:[1,22],21:24,29:25,36:[1,28],38:[1,27],39:26},{5:[2,8],14:[2,8],15:[2,8],16:[2,8],19:[2,8],20:[2,8],22:[2,8],23:[2,8],25:[2,8]},{4:29,6:3,7:4,8:6,9:7,11:8,12:9,13:10,14:[1,11],15:[1,12],16:[1,13],19:[1,5],20:[2,7],22:[1,14],23:[1,15],25:[1,16]},{4:30,6:3,7:4,8:6,9:7,11:8,12:9,13:10,14:[1,11],15:[1,12],16:[1,13],19:[1,5],20:[2,7],22:[1,14],23:[1,15],25:[1,16]},{5:[2,12],14:[2,12],15:[2,12],16:[2,12],19:[2,12],20:[2,12],22:[2,12],23:[2,12],25:[2,12]},{5:[2,13],14:[2,13],15:[2,13],16:[2,13],19:[2,13],20:[2,13],22:[2,13],23:[2,13],25:[2,13]},{5:[2,14],14:[2,14],15:[2,14],16:[2,14],19:[2,14],20:[2,14],22:[2,14],23:[2,14],25:[2,14]},{5:[2,15],14:[2,15],15:[2,15],16:[2,15],19:[2,15],20:[2,15],22:[2,15],23:[2,15],25:[2,15]},{17:31,21:24,29:25,36:[1,28],38:[1,27],39:26},{17:32,21:24,29:25,36:[1,28],38:[1,27],39:26},{17:33,21:24,29:25,36:[1,28],38:[1,27],39:26},{21:35,26:34,31:[1,36],32:[1,37],36:[1,28],39:26},{1:[2,1]},{5:[2,2],8:21,9:7,11:8,12:9,13:10,14:[1,11],15:[1,12],16:[1,13],19:[1,19],20:[2,2],22:[1,14],23:[1,15],25:[1,16]},{17:23,21:24,29:25,36:[1,28],38:[1,27],39:26},{5:[2,4],7:38,8:6,9:7,11:8,12:9,13:10,14:[1,11],15:[1,12],16:[1,13],19:[1,19],20:[2,4],22:[1,14],23:[1,15],25:[1,16]},{5:[2,9],14:[2,9],15:[2,9],16:[2,9],19:[2,9],20:[2,9],22:[2,9],23:[2,9],25:[2,9]},{5:[2,23],14:[2,23],15:[2,23],16:[2,23],19:[2,23],20:[2,23],22:[2,23],23:[2,23],25:[2,23]},{18:[1,39]},{18:[2,27],21:44,24:[2,27],27:40,28:41,29:48,30:42,31:[1,45],32:[1,46],33:[1,47],34:43,35:49,36:[1,50],38:[1,27],39:26},{18:[2,28],24:[2,28]},{18:[2,48],24:[2,48],31:[2,48],32:[2,48],33:[2,48],36:[2,48],38:[2,48],40:[1,51]},{21:52,36:[1,28],39:26},{18:[2,50],24:[2,50],31:[2,50],32:[2,50],33:[2,50],36:[2,50],38:[2,50],40:[2,50]},{10:53,20:[1,54]},{10:55,20:[1,54]},{18:[1,56]},{18:[1,57]},{24:[1,58]},{18:[1,59],21:60,36:[1,28],39:26},{18:[2,44],36:[2,44]},{18:[2,45],36:[2,45]},{18:[2,46],36:[2,46]},{5:[2,3],8:21,9:7,11:8,12:9,13:10,14:[1,11],15:[1,12],16:[1,13],19:[1,19],20:[2,3],22:[1,14],23:[1,15],25:[1,16]},{14:[2,17],15:[2,17],16:[2,17],19:[2,17],20:[2,17],22:[2,17],23:[2,17],25:[2,17]},{18:[2,25],21:44,24:[2,25],28:61,29:48,30:62,31:[1,45],32:[1,46],33:[1,47],34:43,35:49,36:[1,50],38:[1,27],39:26},{18:[2,26],24:[2,26]},{18:[2,30],24:[2,30],31:[2,30],32:[2,30],33:[2,30],36:[2,30],38:[2,30]},{18:[2,36],24:[2,36],35:63,36:[1,64]},{18:[2,31],24:[2,31],31:[2,31],32:[2,31],33:[2,31],36:[2,31],38:[2,31]},{18:[2,32],24:[2,32],31:[2,32],32:[2,32],33:[2,32],36:[2,32],38:[2,32]},{18:[2,33],24:[2,33],31:[2,33],32:[2,33],33:[2,33],36:[2,33],38:[2,33]},{18:[2,34],24:[2,34],31:[2,34],32:[2,34],33:[2,34],36:[2,34],38:[2,34]},{18:[2,35],24:[2,35],31:[2,35],32:[2,35],33:[2,35],36:[2,35],38:[2,35]},{18:[2,38],24:[2,38],36:[2,38]},{18:[2,50],24:[2,50],31:[2,50],32:[2,50],33:[2,50],36:[2,50],37:[1,65],38:[2,50],40:[2,50]},{36:[1,66]},{18:[2,47],24:[2,47],31:[2,47],32:[2,47],33:[2,47],36:[2,47],38:[2,47]},{5:[2,10],14:[2,10],15:[2,10],16:[2,10],19:[2,10],20:[2,10],22:[2,10],23:[2,10],25:[2,10]},{21:67,36:[1,28],39:26},{5:[2,11],14:[2,11],15:[2,11],16:[2,11],19:[2,11],20:[2,11],22:[2,11],23:[2,11],25:[2,11]},{14:[2,16],15:[2,16],16:[2,16],19:[2,16],20:[2,16],22:[2,16],23:[2,16],25:[2,16]},{5:[2,19],14:[2,19],15:[2,19],16:[2,19],19:[2,19],20:[2,19],22:[2,19],23:[2,19],25:[2,19]},{5:[2,20],14:[2,20],15:[2,20],16:[2,20],19:[2,20],20:[2,20],22:[2,20],23:[2,20],25:[2,20]},{5:[2,21],14:[2,21],15:[2,21],16:[2,21],19:[2,21],20:[2,21],22:[2,21],23:[2,21],25:[2,21]},{18:[1,68]},{18:[2,24],24:[2,24]},{18:[2,29],24:[2,29],31:[2,29],32:[2,29],33:[2,29],36:[2,29],38:[2,29]},{18:[2,37],24:[2,37],36:[2,37]},{37:[1,65]},{21:69,29:73,31:[1,70],32:[1,71],33:[1,72],36:[1,28],38:[1,27],39:26},{18:[2,49],24:[2,49],31:[2,49],32:[2,49],33:[2,49],36:[2,49],38:[2,49],40:[2,49]},{18:[1,74]},{5:[2,22],14:[2,22],15:[2,22],16:[2,22],19:[2,22],20:[2,22],22:[2,22],23:[2,22],25:[2,22]},{18:[2,39],24:[2,39],36:[2,39]},{18:[2,40],24:[2,40],36:[2,40]},{18:[2,41],24:[2,41],36:[2,41]},{18:[2,42],24:[2,42],36:[2,42]},{18:[2,43],24:[2,43],36:[2,43]},{5:[2,18],14:[2,18],15:[2,18],16:[2,18],19:[2,18],20:[2,18],22:[2,18],23:[2,18],25:[2,18]}],
defaultActions: {17:[2,1]},
parseError: function parseError(str, hash) {
    throw new Error(str);
},
parse: function parse(input) {
    var self = this, stack = [0], vstack = [null], lstack = [], table = this.table, yytext = "", yylineno = 0, yyleng = 0, recovering = 0, TERROR = 2, EOF = 1;
    this.lexer.setInput(input);
    this.lexer.yy = this.yy;
    this.yy.lexer = this.lexer;
    this.yy.parser = this;
    if (typeof this.lexer.yylloc == "undefined")
        this.lexer.yylloc = {};
    var yyloc = this.lexer.yylloc;
    lstack.push(yyloc);
    var ranges = this.lexer.options && this.lexer.options.ranges;
    if (typeof this.yy.parseError === "function")
        this.parseError = this.yy.parseError;
    function popStack(n) {
        stack.length = stack.length - 2 * n;
        vstack.length = vstack.length - n;
        lstack.length = lstack.length - n;
    }
    function lex() {
        var token;
        token = self.lexer.lex() || 1;
        if (typeof token !== "number") {
            token = self.symbols_[token] || token;
        }
        return token;
    }
    var symbol, preErrorSymbol, state, action, a, r, yyval = {}, p, len, newState, expected;
    while (true) {
        state = stack[stack.length - 1];
        if (this.defaultActions[state]) {
            action = this.defaultActions[state];
        } else {
            if (symbol === null || typeof symbol == "undefined") {
                symbol = lex();
            }
            action = table[state] && table[state][symbol];
        }
        if (typeof action === "undefined" || !action.length || !action[0]) {
            var errStr = "";
            if (!recovering) {
                expected = [];
                for (p in table[state])
                    if (this.terminals_[p] && p > 2) {
                        expected.push("'" + this.terminals_[p] + "'");
                    }
                if (this.lexer.showPosition) {
                    errStr = "Parse error on line " + (yylineno + 1) + ":\n" + this.lexer.showPosition() + "\nExpecting " + expected.join(", ") + ", got '" + (this.terminals_[symbol] || symbol) + "'";
                } else {
                    errStr = "Parse error on line " + (yylineno + 1) + ": Unexpected " + (symbol == 1?"end of input":"'" + (this.terminals_[symbol] || symbol) + "'");
                }
                this.parseError(errStr, {text: this.lexer.match, token: this.terminals_[symbol] || symbol, line: this.lexer.yylineno, loc: yyloc, expected: expected});
            }
        }
        if (action[0] instanceof Array && action.length > 1) {
            throw new Error("Parse Error: multiple actions possible at state: " + state + ", token: " + symbol);
        }
        switch (action[0]) {
        case 1:
            stack.push(symbol);
            vstack.push(this.lexer.yytext);
            lstack.push(this.lexer.yylloc);
            stack.push(action[1]);
            symbol = null;
            if (!preErrorSymbol) {
                yyleng = this.lexer.yyleng;
                yytext = this.lexer.yytext;
                yylineno = this.lexer.yylineno;
                yyloc = this.lexer.yylloc;
                if (recovering > 0)
                    recovering--;
            } else {
                symbol = preErrorSymbol;
                preErrorSymbol = null;
            }
            break;
        case 2:
            len = this.productions_[action[1]][1];
            yyval.$ = vstack[vstack.length - len];
            yyval._$ = {first_line: lstack[lstack.length - (len || 1)].first_line, last_line: lstack[lstack.length - 1].last_line, first_column: lstack[lstack.length - (len || 1)].first_column, last_column: lstack[lstack.length - 1].last_column};
            if (ranges) {
                yyval._$.range = [lstack[lstack.length - (len || 1)].range[0], lstack[lstack.length - 1].range[1]];
            }
            r = this.performAction.call(yyval, yytext, yyleng, yylineno, this.yy, action[1], vstack, lstack);
            if (typeof r !== "undefined") {
                return r;
            }
            if (len) {
                stack = stack.slice(0, -1 * len * 2);
                vstack = vstack.slice(0, -1 * len);
                lstack = lstack.slice(0, -1 * len);
            }
            stack.push(this.productions_[action[1]][0]);
            vstack.push(yyval.$);
            lstack.push(yyval._$);
            newState = table[stack[stack.length - 2]][stack[stack.length - 1]];
            stack.push(newState);
            break;
        case 3:
            return true;
        }
    }
    return true;
}
};
/* Jison generated lexer */
var lexer = (function(){
var lexer = ({EOF:1,
parseError:function parseError(str, hash) {
        if (this.yy.parser) {
            this.yy.parser.parseError(str, hash);
        } else {
            throw new Error(str);
        }
    },
setInput:function (input) {
        this._input = input;
        this._more = this._less = this.done = false;
        this.yylineno = this.yyleng = 0;
        this.yytext = this.matched = this.match = '';
        this.conditionStack = ['INITIAL'];
        this.yylloc = {first_line:1,first_column:0,last_line:1,last_column:0};
        if (this.options.ranges) this.yylloc.range = [0,0];
        this.offset = 0;
        return this;
    },
input:function () {
        var ch = this._input[0];
        this.yytext += ch;
        this.yyleng++;
        this.offset++;
        this.match += ch;
        this.matched += ch;
        var lines = ch.match(/(?:\r\n?|\n).*/g);
        if (lines) {
            this.yylineno++;
            this.yylloc.last_line++;
        } else {
            this.yylloc.last_column++;
        }
        if (this.options.ranges) this.yylloc.range[1]++;

        this._input = this._input.slice(1);
        return ch;
    },
unput:function (ch) {
        var len = ch.length;
        var lines = ch.split(/(?:\r\n?|\n)/g);

        this._input = ch + this._input;
        this.yytext = this.yytext.substr(0, this.yytext.length-len-1);
        //this.yyleng -= len;
        this.offset -= len;
        var oldLines = this.match.split(/(?:\r\n?|\n)/g);
        this.match = this.match.substr(0, this.match.length-1);
        this.matched = this.matched.substr(0, this.matched.length-1);

        if (lines.length-1) this.yylineno -= lines.length-1;
        var r = this.yylloc.range;

        this.yylloc = {first_line: this.yylloc.first_line,
          last_line: this.yylineno+1,
          first_column: this.yylloc.first_column,
          last_column: lines ?
              (lines.length === oldLines.length ? this.yylloc.first_column : 0) + oldLines[oldLines.length - lines.length].length - lines[0].length:
              this.yylloc.first_column - len
          };

        if (this.options.ranges) {
            this.yylloc.range = [r[0], r[0] + this.yyleng - len];
        }
        return this;
    },
more:function () {
        this._more = true;
        return this;
    },
less:function (n) {
        this.unput(this.match.slice(n));
    },
pastInput:function () {
        var past = this.matched.substr(0, this.matched.length - this.match.length);
        return (past.length > 20 ? '...':'') + past.substr(-20).replace(/\n/g, "");
    },
upcomingInput:function () {
        var next = this.match;
        if (next.length < 20) {
            next += this._input.substr(0, 20-next.length);
        }
        return (next.substr(0,20)+(next.length > 20 ? '...':'')).replace(/\n/g, "");
    },
showPosition:function () {
        var pre = this.pastInput();
        var c = new Array(pre.length + 1).join("-");
        return pre + this.upcomingInput() + "\n" + c+"^";
    },
next:function () {
        if (this.done) {
            return this.EOF;
        }
        if (!this._input) this.done = true;

        var token,
            match,
            tempMatch,
            index,
            col,
            lines;
        if (!this._more) {
            this.yytext = '';
            this.match = '';
        }
        var rules = this._currentRules();
        for (var i=0;i < rules.length; i++) {
            tempMatch = this._input.match(this.rules[rules[i]]);
            if (tempMatch && (!match || tempMatch[0].length > match[0].length)) {
                match = tempMatch;
                index = i;
                if (!this.options.flex) break;
            }
        }
        if (match) {
            lines = match[0].match(/(?:\r\n?|\n).*/g);
            if (lines) this.yylineno += lines.length;
            this.yylloc = {first_line: this.yylloc.last_line,
                           last_line: this.yylineno+1,
                           first_column: this.yylloc.last_column,
                           last_column: lines ? lines[lines.length-1].length-lines[lines.length-1].match(/\r?\n?/)[0].length : this.yylloc.last_column + match[0].length};
            this.yytext += match[0];
            this.match += match[0];
            this.matches = match;
            this.yyleng = this.yytext.length;
            if (this.options.ranges) {
                this.yylloc.range = [this.offset, this.offset += this.yyleng];
            }
            this._more = false;
            this._input = this._input.slice(match[0].length);
            this.matched += match[0];
            token = this.performAction.call(this, this.yy, this, rules[index],this.conditionStack[this.conditionStack.length-1]);
            if (this.done && this._input) this.done = false;
            if (token) return token;
            else return;
        }
        if (this._input === "") {
            return this.EOF;
        } else {
            return this.parseError('Lexical error on line '+(this.yylineno+1)+'. Unrecognized text.\n'+this.showPosition(),
                    {text: "", token: null, line: this.yylineno});
        }
    },
lex:function lex() {
        var r = this.next();
        if (typeof r !== 'undefined') {
            return r;
        } else {
            return this.lex();
        }
    },
begin:function begin(condition) {
        this.conditionStack.push(condition);
    },
popState:function popState() {
        return this.conditionStack.pop();
    },
_currentRules:function _currentRules() {
        return this.conditions[this.conditionStack[this.conditionStack.length-1]].rules;
    },
topState:function () {
        return this.conditionStack[this.conditionStack.length-2];
    },
pushState:function begin(condition) {
        this.begin(condition);
    }});
lexer.options = {};
lexer.performAction = function anonymous(yy,yy_,$avoiding_name_collisions,YY_START) {

var YYSTATE=YY_START
switch($avoiding_name_collisions) {
case 0: yy_.yytext = "\\"; return 14; 
break;
case 1:
                                   if(yy_.yytext.slice(-1) !== "\\") this.begin("mu");
                                   if(yy_.yytext.slice(-1) === "\\") yy_.yytext = yy_.yytext.substr(0,yy_.yyleng-1), this.begin("emu");
                                   if(yy_.yytext) return 14;
                                 
break;
case 2: return 14; 
break;
case 3:
                                   if(yy_.yytext.slice(-1) !== "\\") this.popState();
                                   if(yy_.yytext.slice(-1) === "\\") yy_.yytext = yy_.yytext.substr(0,yy_.yyleng-1);
                                   return 14;
                                 
break;
case 4: yy_.yytext = yy_.yytext.substr(0, yy_.yyleng-4); this.popState(); return 15; 
break;
case 5: return 25; 
break;
case 6: return 16; 
break;
case 7: return 20; 
break;
case 8: return 19; 
break;
case 9: return 19; 
break;
case 10: return 23; 
break;
case 11: return 22; 
break;
case 12: this.popState(); this.begin('com'); 
break;
case 13: yy_.yytext = yy_.yytext.substr(3,yy_.yyleng-5); this.popState(); return 15; 
break;
case 14: return 22; 
break;
case 15: return 37; 
break;
case 16: return 36; 
break;
case 17: return 36; 
break;
case 18: return 40; 
break;
case 19: /*ignore whitespace*/ 
break;
case 20: this.popState(); return 24; 
break;
case 21: this.popState(); return 18; 
break;
case 22: yy_.yytext = yy_.yytext.substr(1,yy_.yyleng-2).replace(/\\"/g,'"'); return 31; 
break;
case 23: yy_.yytext = yy_.yytext.substr(1,yy_.yyleng-2).replace(/\\'/g,"'"); return 31; 
break;
case 24: return 38; 
break;
case 25: return 33; 
break;
case 26: return 33; 
break;
case 27: return 32; 
break;
case 28: return 36; 
break;
case 29: yy_.yytext = yy_.yytext.substr(1, yy_.yyleng-2); return 36; 
break;
case 30: return 'INVALID'; 
break;
case 31: return 5; 
break;
}
};
lexer.rules = [/^(?:\\\\(?=(\{\{)))/,/^(?:[^\x00]*?(?=(\{\{)))/,/^(?:[^\x00]+)/,/^(?:[^\x00]{2,}?(?=(\{\{|$)))/,/^(?:[\s\S]*?--\}\})/,/^(?:\{\{>)/,/^(?:\{\{#)/,/^(?:\{\{\/)/,/^(?:\{\{\^)/,/^(?:\{\{\s*else\b)/,/^(?:\{\{\{)/,/^(?:\{\{&)/,/^(?:\{\{!--)/,/^(?:\{\{![\s\S]*?\}\})/,/^(?:\{\{)/,/^(?:=)/,/^(?:\.(?=[}\/ ]))/,/^(?:\.\.)/,/^(?:[\/.])/,/^(?:\s+)/,/^(?:\}\}\})/,/^(?:\}\})/,/^(?:"(\\["]|[^"])*")/,/^(?:'(\\[']|[^'])*')/,/^(?:@)/,/^(?:true(?=[}\s]))/,/^(?:false(?=[}\s]))/,/^(?:-?[0-9]+(?=[}\s]))/,/^(?:[^\s!"#%-,\.\/;->@\[-\^`\{-~]+(?=[=}\s\/.]))/,/^(?:\[[^\]]*\])/,/^(?:.)/,/^(?:$)/];
lexer.conditions = {"mu":{"rules":[5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31],"inclusive":false},"emu":{"rules":[3],"inclusive":false},"com":{"rules":[4],"inclusive":false},"INITIAL":{"rules":[0,1,2,31],"inclusive":true}};
return lexer;})()
parser.lexer = lexer;
function Parser () { this.yy = {}; }Parser.prototype = parser;parser.Parser = Parser;
return new Parser;
})();;
// lib/handlebars/compiler/base.js

Handlebars.Parser = handlebars;

Handlebars.parse = function(input) {

  // Just return if an already-compile AST was passed in.
  if(input.constructor === Handlebars.AST.ProgramNode) { return input; }

  Handlebars.Parser.yy = Handlebars.AST;
  return Handlebars.Parser.parse(input);
};
;
// lib/handlebars/compiler/ast.js
Handlebars.AST = {};

Handlebars.AST.ProgramNode = function(statements, inverse) {
  this.type = "program";
  this.statements = statements;
  if(inverse) { this.inverse = new Handlebars.AST.ProgramNode(inverse); }
};

Handlebars.AST.MustacheNode = function(rawParams, hash, unescaped) {
  this.type = "mustache";
  this.escaped = !unescaped;
  this.hash = hash;

  var id = this.id = rawParams[0];
  var params = this.params = rawParams.slice(1);

  // a mustache is an eligible helper if:
  // * its id is simple (a single part, not `this` or `..`)
  var eligibleHelper = this.eligibleHelper = id.isSimple;

  // a mustache is definitely a helper if:
  // * it is an eligible helper, and
  // * it has at least one parameter or hash segment
  this.isHelper = eligibleHelper && (params.length || hash);

  // if a mustache is an eligible helper but not a definite
  // helper, it is ambiguous, and will be resolved in a later
  // pass or at runtime.
};

Handlebars.AST.PartialNode = function(partialName, context) {
  this.type         = "partial";
  this.partialName  = partialName;
  this.context      = context;
};

Handlebars.AST.BlockNode = function(mustache, program, inverse, close) {
  var verifyMatch = function(open, close) {
    if(open.original !== close.original) {
      throw new Handlebars.Exception(open.original + " doesn't match " + close.original);
    }
  };

  verifyMatch(mustache.id, close);
  this.type = "block";
  this.mustache = mustache;
  this.program  = program;
  this.inverse  = inverse;

  if (this.inverse && !this.program) {
    this.isInverse = true;
  }
};

Handlebars.AST.ContentNode = function(string) {
  this.type = "content";
  this.string = string;
};

Handlebars.AST.HashNode = function(pairs) {
  this.type = "hash";
  this.pairs = pairs;
};

Handlebars.AST.IdNode = function(parts) {
  this.type = "ID";

  var original = "",
      dig = [],
      depth = 0;

  for(var i=0,l=parts.length; i<l; i++) {
    var part = parts[i].part;
    original += (parts[i].separator || '') + part;

    if (part === ".." || part === "." || part === "this") {
      if (dig.length > 0) { throw new Handlebars.Exception("Invalid path: " + original); }
      else if (part === "..") { depth++; }
      else { this.isScoped = true; }
    }
    else { dig.push(part); }
  }

  this.original = original;
  this.parts    = dig;
  this.string   = dig.join('.');
  this.depth    = depth;

  // an ID is simple if it only has one part, and that part is not
  // `..` or `this`.
  this.isSimple = parts.length === 1 && !this.isScoped && depth === 0;

  this.stringModeValue = this.string;
};

Handlebars.AST.PartialNameNode = function(name) {
  this.type = "PARTIAL_NAME";
  this.name = name.original;
};

Handlebars.AST.DataNode = function(id) {
  this.type = "DATA";
  this.id = id;
};

Handlebars.AST.StringNode = function(string) {
  this.type = "STRING";
  this.original =
    this.string =
    this.stringModeValue = string;
};

Handlebars.AST.IntegerNode = function(integer) {
  this.type = "INTEGER";
  this.original =
    this.integer = integer;
  this.stringModeValue = Number(integer);
};

Handlebars.AST.BooleanNode = function(bool) {
  this.type = "BOOLEAN";
  this.bool = bool;
  this.stringModeValue = bool === "true";
};

Handlebars.AST.CommentNode = function(comment) {
  this.type = "comment";
  this.comment = comment;
};
;
// lib/handlebars/utils.js

var errorProps = ['description', 'fileName', 'lineNumber', 'message', 'name', 'number', 'stack'];

Handlebars.Exception = function(message) {
  var tmp = Error.prototype.constructor.apply(this, arguments);

  // Unfortunately errors are not enumerable in Chrome (at least), so `for prop in tmp` doesn't work.
  for (var idx = 0; idx < errorProps.length; idx++) {
    this[errorProps[idx]] = tmp[errorProps[idx]];
  }
};
Handlebars.Exception.prototype = new Error();

// Build out our basic SafeString type
Handlebars.SafeString = function(string) {
  this.string = string;
};
Handlebars.SafeString.prototype.toString = function() {
  return this.string.toString();
};

var escape = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#x27;",
  "`": "&#x60;"
};

var badChars = /[&<>"'`]/g;
var possible = /[&<>"'`]/;

var escapeChar = function(chr) {
  return escape[chr] || "&amp;";
};

Handlebars.Utils = {
  extend: function(obj, value) {
    for(var key in value) {
      if(value.hasOwnProperty(key)) {
        obj[key] = value[key];
      }
    }
  },

  escapeExpression: function(string) {
    // don't escape SafeStrings, since they're already safe
    if (string instanceof Handlebars.SafeString) {
      return string.toString();
    } else if (string == null || string === false) {
      return "";
    }

    // Force a string conversion as this will be done by the append regardless and
    // the regex test will do this transparently behind the scenes, causing issues if
    // an object's to string has escaped characters in it.
    string = string.toString();

    if(!possible.test(string)) { return string; }
    return string.replace(badChars, escapeChar);
  },

  isEmpty: function(value) {
    if (!value && value !== 0) {
      return true;
    } else if(toString.call(value) === "[object Array]" && value.length === 0) {
      return true;
    } else {
      return false;
    }
  }
};
;
// lib/handlebars/compiler/compiler.js

/*jshint eqnull:true*/
var Compiler = Handlebars.Compiler = function() {};
var JavaScriptCompiler = Handlebars.JavaScriptCompiler = function() {};

// the foundHelper register will disambiguate helper lookup from finding a
// function in a context. This is necessary for mustache compatibility, which
// requires that context functions in blocks are evaluated by blockHelperMissing,
// and then proceed as if the resulting value was provided to blockHelperMissing.

Compiler.prototype = {
  compiler: Compiler,

  disassemble: function() {
    var opcodes = this.opcodes, opcode, out = [], params, param;

    for (var i=0, l=opcodes.length; i<l; i++) {
      opcode = opcodes[i];

      if (opcode.opcode === 'DECLARE') {
        out.push("DECLARE " + opcode.name + "=" + opcode.value);
      } else {
        params = [];
        for (var j=0; j<opcode.args.length; j++) {
          param = opcode.args[j];
          if (typeof param === "string") {
            param = "\"" + param.replace("\n", "\\n") + "\"";
          }
          params.push(param);
        }
        out.push(opcode.opcode + " " + params.join(" "));
      }
    }

    return out.join("\n");
  },
  equals: function(other) {
    var len = this.opcodes.length;
    if (other.opcodes.length !== len) {
      return false;
    }

    for (var i = 0; i < len; i++) {
      var opcode = this.opcodes[i],
          otherOpcode = other.opcodes[i];
      if (opcode.opcode !== otherOpcode.opcode || opcode.args.length !== otherOpcode.args.length) {
        return false;
      }
      for (var j = 0; j < opcode.args.length; j++) {
        if (opcode.args[j] !== otherOpcode.args[j]) {
          return false;
        }
      }
    }

    len = this.children.length;
    if (other.children.length !== len) {
      return false;
    }
    for (i = 0; i < len; i++) {
      if (!this.children[i].equals(other.children[i])) {
        return false;
      }
    }

    return true;
  },

  guid: 0,

  compile: function(program, options) {
    this.children = [];
    this.depths = {list: []};
    this.options = options;

    // These changes will propagate to the other compiler components
    var knownHelpers = this.options.knownHelpers;
    this.options.knownHelpers = {
      'helperMissing': true,
      'blockHelperMissing': true,
      'each': true,
      'if': true,
      'unless': true,
      'with': true,
      'log': true
    };
    if (knownHelpers) {
      for (var name in knownHelpers) {
        this.options.knownHelpers[name] = knownHelpers[name];
      }
    }

    return this.program(program);
  },

  accept: function(node) {
    return this[node.type](node);
  },

  program: function(program) {
    var statements = program.statements, statement;
    this.opcodes = [];

    for(var i=0, l=statements.length; i<l; i++) {
      statement = statements[i];
      this[statement.type](statement);
    }
    this.isSimple = l === 1;

    this.depths.list = this.depths.list.sort(function(a, b) {
      return a - b;
    });

    return this;
  },

  compileProgram: function(program) {
    var result = new this.compiler().compile(program, this.options);
    var guid = this.guid++, depth;

    this.usePartial = this.usePartial || result.usePartial;

    this.children[guid] = result;

    for(var i=0, l=result.depths.list.length; i<l; i++) {
      depth = result.depths.list[i];

      if(depth < 2) { continue; }
      else { this.addDepth(depth - 1); }
    }

    return guid;
  },

  block: function(block) {
    var mustache = block.mustache,
        program = block.program,
        inverse = block.inverse;

    if (program) {
      program = this.compileProgram(program);
    }

    if (inverse) {
      inverse = this.compileProgram(inverse);
    }

    var type = this.classifyMustache(mustache);

    if (type === "helper") {
      this.helperMustache(mustache, program, inverse);
    } else if (type === "simple") {
      this.simpleMustache(mustache);

      // now that the simple mustache is resolved, we need to
      // evaluate it by executing `blockHelperMissing`
      this.opcode('pushProgram', program);
      this.opcode('pushProgram', inverse);
      this.opcode('emptyHash');
      this.opcode('blockValue');
    } else {
      this.ambiguousMustache(mustache, program, inverse);

      // now that the simple mustache is resolved, we need to
      // evaluate it by executing `blockHelperMissing`
      this.opcode('pushProgram', program);
      this.opcode('pushProgram', inverse);
      this.opcode('emptyHash');
      this.opcode('ambiguousBlockValue');
    }

    this.opcode('append');
  },

  hash: function(hash) {
    var pairs = hash.pairs, pair, val;

    this.opcode('pushHash');

    for(var i=0, l=pairs.length; i<l; i++) {
      pair = pairs[i];
      val  = pair[1];

      if (this.options.stringParams) {
        if(val.depth) {
          this.addDepth(val.depth);
        }
        this.opcode('getContext', val.depth || 0);
        this.opcode('pushStringParam', val.stringModeValue, val.type);
      } else {
        this.accept(val);
      }

      this.opcode('assignToHash', pair[0]);
    }
    this.opcode('popHash');
  },

  partial: function(partial) {
    var partialName = partial.partialName;
    this.usePartial = true;

    if(partial.context) {
      this.ID(partial.context);
    } else {
      this.opcode('push', 'depth0');
    }

    this.opcode('invokePartial', partialName.name);
    this.opcode('append');
  },

  content: function(content) {
    this.opcode('appendContent', content.string);
  },

  mustache: function(mustache) {
    var options = this.options;
    var type = this.classifyMustache(mustache);

    if (type === "simple") {
      this.simpleMustache(mustache);
    } else if (type === "helper") {
      this.helperMustache(mustache);
    } else {
      this.ambiguousMustache(mustache);
    }

    if(mustache.escaped && !options.noEscape) {
      this.opcode('appendEscaped');
    } else {
      this.opcode('append');
    }
  },

  ambiguousMustache: function(mustache, program, inverse) {
    var id = mustache.id,
        name = id.parts[0],
        isBlock = program != null || inverse != null;

    this.opcode('getContext', id.depth);

    this.opcode('pushProgram', program);
    this.opcode('pushProgram', inverse);

    this.opcode('invokeAmbiguous', name, isBlock);
  },

  simpleMustache: function(mustache) {
    var id = mustache.id;

    if (id.type === 'DATA') {
      this.DATA(id);
    } else if (id.parts.length) {
      this.ID(id);
    } else {
      // Simplified ID for `this`
      this.addDepth(id.depth);
      this.opcode('getContext', id.depth);
      this.opcode('pushContext');
    }

    this.opcode('resolvePossibleLambda');
  },

  helperMustache: function(mustache, program, inverse) {
    var params = this.setupFullMustacheParams(mustache, program, inverse),
        name = mustache.id.parts[0];

    if (this.options.knownHelpers[name]) {
      this.opcode('invokeKnownHelper', params.length, name);
    } else if (this.options.knownHelpersOnly) {
      throw new Error("You specified knownHelpersOnly, but used the unknown helper " + name);
    } else {
      this.opcode('invokeHelper', params.length, name);
    }
  },

  ID: function(id) {
    this.addDepth(id.depth);
    this.opcode('getContext', id.depth);

    var name = id.parts[0];
    if (!name) {
      this.opcode('pushContext');
    } else {
      this.opcode('lookupOnContext', id.parts[0]);
    }

    for(var i=1, l=id.parts.length; i<l; i++) {
      this.opcode('lookup', id.parts[i]);
    }
  },

  DATA: function(data) {
    this.options.data = true;
    if (data.id.isScoped || data.id.depth) {
      throw new Handlebars.Exception('Scoped data references are not supported: ' + data.original);
    }

    this.opcode('lookupData');
    var parts = data.id.parts;
    for(var i=0, l=parts.length; i<l; i++) {
      this.opcode('lookup', parts[i]);
    }
  },

  STRING: function(string) {
    this.opcode('pushString', string.string);
  },

  INTEGER: function(integer) {
    this.opcode('pushLiteral', integer.integer);
  },

  BOOLEAN: function(bool) {
    this.opcode('pushLiteral', bool.bool);
  },

  comment: function() {},

  // HELPERS
  opcode: function(name) {
    this.opcodes.push({ opcode: name, args: [].slice.call(arguments, 1) });
  },

  declare: function(name, value) {
    this.opcodes.push({ opcode: 'DECLARE', name: name, value: value });
  },

  addDepth: function(depth) {
    if(isNaN(depth)) { throw new Error("EWOT"); }
    if(depth === 0) { return; }

    if(!this.depths[depth]) {
      this.depths[depth] = true;
      this.depths.list.push(depth);
    }
  },

  classifyMustache: function(mustache) {
    var isHelper   = mustache.isHelper;
    var isEligible = mustache.eligibleHelper;
    var options    = this.options;

    // if ambiguous, we can possibly resolve the ambiguity now
    if (isEligible && !isHelper) {
      var name = mustache.id.parts[0];

      if (options.knownHelpers[name]) {
        isHelper = true;
      } else if (options.knownHelpersOnly) {
        isEligible = false;
      }
    }

    if (isHelper) { return "helper"; }
    else if (isEligible) { return "ambiguous"; }
    else { return "simple"; }
  },

  pushParams: function(params) {
    var i = params.length, param;

    while(i--) {
      param = params[i];

      if(this.options.stringParams) {
        if(param.depth) {
          this.addDepth(param.depth);
        }

        this.opcode('getContext', param.depth || 0);
        this.opcode('pushStringParam', param.stringModeValue, param.type);
      } else {
        this[param.type](param);
      }
    }
  },

  setupMustacheParams: function(mustache) {
    var params = mustache.params;
    this.pushParams(params);

    if(mustache.hash) {
      this.hash(mustache.hash);
    } else {
      this.opcode('emptyHash');
    }

    return params;
  },

  // this will replace setupMustacheParams when we're done
  setupFullMustacheParams: function(mustache, program, inverse) {
    var params = mustache.params;
    this.pushParams(params);

    this.opcode('pushProgram', program);
    this.opcode('pushProgram', inverse);

    if(mustache.hash) {
      this.hash(mustache.hash);
    } else {
      this.opcode('emptyHash');
    }

    return params;
  }
};

var Literal = function(value) {
  this.value = value;
};

JavaScriptCompiler.prototype = {
  // PUBLIC API: You can override these methods in a subclass to provide
  // alternative compiled forms for name lookup and buffering semantics
  nameLookup: function(parent, name /* , type*/) {
    if (/^[0-9]+$/.test(name)) {
      return parent + "[" + name + "]";
    } else if (JavaScriptCompiler.isValidJavaScriptVariableName(name)) {
      return parent + "." + name;
    }
    else {
      return parent + "['" + name + "']";
    }
  },

  appendToBuffer: function(string) {
    if (this.environment.isSimple) {
      return "return " + string + ";";
    } else {
      return {
        appendToBuffer: true,
        content: string,
        toString: function() { return "buffer += " + string + ";"; }
      };
    }
  },

  initializeBuffer: function() {
    return this.quotedString("");
  },

  namespace: "Handlebars",
  // END PUBLIC API

  compile: function(environment, options, context, asObject) {
    this.environment = environment;
    this.options = options || {};

    Handlebars.log(Handlebars.logger.DEBUG, this.environment.disassemble() + "\n\n");

    this.name = this.environment.name;
    this.isChild = !!context;
    this.context = context || {
      programs: [],
      environments: [],
      aliases: { }
    };

    this.preamble();

    this.stackSlot = 0;
    this.stackVars = [];
    this.registers = { list: [] };
    this.compileStack = [];
    this.inlineStack = [];

    this.compileChildren(environment, options);

    var opcodes = environment.opcodes, opcode;

    this.i = 0;

    for(l=opcodes.length; this.i<l; this.i++) {
      opcode = opcodes[this.i];

      if(opcode.opcode === 'DECLARE') {
        this[opcode.name] = opcode.value;
      } else {
        this[opcode.opcode].apply(this, opcode.args);
      }
    }

    return this.createFunctionContext(asObject);
  },

  nextOpcode: function() {
    var opcodes = this.environment.opcodes;
    return opcodes[this.i + 1];
  },

  eat: function() {
    this.i = this.i + 1;
  },

  preamble: function() {
    var out = [];

    if (!this.isChild) {
      var namespace = this.namespace;

      var copies = "helpers = this.merge(helpers, " + namespace + ".helpers);";
      if (this.environment.usePartial) { copies = copies + " partials = this.merge(partials, " + namespace + ".partials);"; }
      if (this.options.data) { copies = copies + " data = data || {};"; }
      out.push(copies);
    } else {
      out.push('');
    }

    if (!this.environment.isSimple) {
      out.push(", buffer = " + this.initializeBuffer());
    } else {
      out.push("");
    }

    // track the last context pushed into place to allow skipping the
    // getContext opcode when it would be a noop
    this.lastContext = 0;
    this.source = out;
  },

  createFunctionContext: function(asObject) {
    var locals = this.stackVars.concat(this.registers.list);

    if(locals.length > 0) {
      this.source[1] = this.source[1] + ", " + locals.join(", ");
    }

    // Generate minimizer alias mappings
    if (!this.isChild) {
      for (var alias in this.context.aliases) {
        if (this.context.aliases.hasOwnProperty(alias)) {
          this.source[1] = this.source[1] + ', ' + alias + '=' + this.context.aliases[alias];
        }
      }
    }

    if (this.source[1]) {
      this.source[1] = "var " + this.source[1].substring(2) + ";";
    }

    // Merge children
    if (!this.isChild) {
      this.source[1] += '\n' + this.context.programs.join('\n') + '\n';
    }

    if (!this.environment.isSimple) {
      this.source.push("return buffer;");
    }

    var params = this.isChild ? ["depth0", "data"] : ["Handlebars", "depth0", "helpers", "partials", "data"];

    for(var i=0, l=this.environment.depths.list.length; i<l; i++) {
      params.push("depth" + this.environment.depths.list[i]);
    }

    // Perform a second pass over the output to merge content when possible
    var source = this.mergeSource();

    if (!this.isChild) {
      var revision = Handlebars.COMPILER_REVISION,
          versions = Handlebars.REVISION_CHANGES[revision];
      source = "this.compilerInfo = ["+revision+",'"+versions+"'];\n"+source;
    }

    if (asObject) {
      params.push(source);

      return Function.apply(this, params);
    } else {
      var functionSource = 'function ' + (this.name || '') + '(' + params.join(',') + ') {\n  ' + source + '}';
      Handlebars.log(Handlebars.logger.DEBUG, functionSource + "\n\n");
      return functionSource;
    }
  },
  mergeSource: function() {
    // WARN: We are not handling the case where buffer is still populated as the source should
    // not have buffer append operations as their final action.
    var source = '',
        buffer;
    for (var i = 0, len = this.source.length; i < len; i++) {
      var line = this.source[i];
      if (line.appendToBuffer) {
        if (buffer) {
          buffer = buffer + '\n    + ' + line.content;
        } else {
          buffer = line.content;
        }
      } else {
        if (buffer) {
          source += 'buffer += ' + buffer + ';\n  ';
          buffer = undefined;
        }
        source += line + '\n  ';
      }
    }
    return source;
  },

  // [blockValue]
  //
  // On stack, before: hash, inverse, program, value
  // On stack, after: return value of blockHelperMissing
  //
  // The purpose of this opcode is to take a block of the form
  // `{{#foo}}...{{/foo}}`, resolve the value of `foo`, and
  // replace it on the stack with the result of properly
  // invoking blockHelperMissing.
  blockValue: function() {
    this.context.aliases.blockHelperMissing = 'helpers.blockHelperMissing';

    var params = ["depth0"];
    this.setupParams(0, params);

    this.replaceStack(function(current) {
      params.splice(1, 0, current);
      return "blockHelperMissing.call(" + params.join(", ") + ")";
    });
  },

  // [ambiguousBlockValue]
  //
  // On stack, before: hash, inverse, program, value
  // Compiler value, before: lastHelper=value of last found helper, if any
  // On stack, after, if no lastHelper: same as [blockValue]
  // On stack, after, if lastHelper: value
  ambiguousBlockValue: function() {
    this.context.aliases.blockHelperMissing = 'helpers.blockHelperMissing';

    var params = ["depth0"];
    this.setupParams(0, params);

    var current = this.topStack();
    params.splice(1, 0, current);

    // Use the options value generated from the invocation
    params[params.length-1] = 'options';

    this.source.push("if (!" + this.lastHelper + ") { " + current + " = blockHelperMissing.call(" + params.join(", ") + "); }");
  },

  // [appendContent]
  //
  // On stack, before: ...
  // On stack, after: ...
  //
  // Appends the string value of `content` to the current buffer
  appendContent: function(content) {
    this.source.push(this.appendToBuffer(this.quotedString(content)));
  },

  // [append]
  //
  // On stack, before: value, ...
  // On stack, after: ...
  //
  // Coerces `value` to a String and appends it to the current buffer.
  //
  // If `value` is truthy, or 0, it is coerced into a string and appended
  // Otherwise, the empty string is appended
  append: function() {
    // Force anything that is inlined onto the stack so we don't have duplication
    // when we examine local
    this.flushInline();
    var local = this.popStack();
    this.source.push("if(" + local + " || " + local + " === 0) { " + this.appendToBuffer(local) + " }");
    if (this.environment.isSimple) {
      this.source.push("else { " + this.appendToBuffer("''") + " }");
    }
  },

  // [appendEscaped]
  //
  // On stack, before: value, ...
  // On stack, after: ...
  //
  // Escape `value` and append it to the buffer
  appendEscaped: function() {
    this.context.aliases.escapeExpression = 'this.escapeExpression';

    this.source.push(this.appendToBuffer("escapeExpression(" + this.popStack() + ")"));
  },

  // [getContext]
  //
  // On stack, before: ...
  // On stack, after: ...
  // Compiler value, after: lastContext=depth
  //
  // Set the value of the `lastContext` compiler value to the depth
  getContext: function(depth) {
    if(this.lastContext !== depth) {
      this.lastContext = depth;
    }
  },

  // [lookupOnContext]
  //
  // On stack, before: ...
  // On stack, after: currentContext[name], ...
  //
  // Looks up the value of `name` on the current context and pushes
  // it onto the stack.
  lookupOnContext: function(name) {
    this.push(this.nameLookup('depth' + this.lastContext, name, 'context'));
  },

  // [pushContext]
  //
  // On stack, before: ...
  // On stack, after: currentContext, ...
  //
  // Pushes the value of the current context onto the stack.
  pushContext: function() {
    this.pushStackLiteral('depth' + this.lastContext);
  },

  // [resolvePossibleLambda]
  //
  // On stack, before: value, ...
  // On stack, after: resolved value, ...
  //
  // If the `value` is a lambda, replace it on the stack by
  // the return value of the lambda
  resolvePossibleLambda: function() {
    this.context.aliases.functionType = '"function"';

    this.replaceStack(function(current) {
      return "typeof " + current + " === functionType ? " + current + ".apply(depth0) : " + current;
    });
  },

  // [lookup]
  //
  // On stack, before: value, ...
  // On stack, after: value[name], ...
  //
  // Replace the value on the stack with the result of looking
  // up `name` on `value`
  lookup: function(name) {
    this.replaceStack(function(current) {
      return current + " == null || " + current + " === false ? " + current + " : " + this.nameLookup(current, name, 'context');
    });
  },

  // [lookupData]
  //
  // On stack, before: ...
  // On stack, after: data[id], ...
  //
  // Push the result of looking up `id` on the current data
  lookupData: function(id) {
    this.push('data');
  },

  // [pushStringParam]
  //
  // On stack, before: ...
  // On stack, after: string, currentContext, ...
  //
  // This opcode is designed for use in string mode, which
  // provides the string value of a parameter along with its
  // depth rather than resolving it immediately.
  pushStringParam: function(string, type) {
    this.pushStackLiteral('depth' + this.lastContext);

    this.pushString(type);

    if (typeof string === 'string') {
      this.pushString(string);
    } else {
      this.pushStackLiteral(string);
    }
  },

  emptyHash: function() {
    this.pushStackLiteral('{}');

    if (this.options.stringParams) {
      this.register('hashTypes', '{}');
      this.register('hashContexts', '{}');
    }
  },
  pushHash: function() {
    this.hash = {values: [], types: [], contexts: []};
  },
  popHash: function() {
    var hash = this.hash;
    this.hash = undefined;

    if (this.options.stringParams) {
      this.register('hashContexts', '{' + hash.contexts.join(',') + '}');
      this.register('hashTypes', '{' + hash.types.join(',') + '}');
    }
    this.push('{\n    ' + hash.values.join(',\n    ') + '\n  }');
  },

  // [pushString]
  //
  // On stack, before: ...
  // On stack, after: quotedString(string), ...
  //
  // Push a quoted version of `string` onto the stack
  pushString: function(string) {
    this.pushStackLiteral(this.quotedString(string));
  },

  // [push]
  //
  // On stack, before: ...
  // On stack, after: expr, ...
  //
  // Push an expression onto the stack
  push: function(expr) {
    this.inlineStack.push(expr);
    return expr;
  },

  // [pushLiteral]
  //
  // On stack, before: ...
  // On stack, after: value, ...
  //
  // Pushes a value onto the stack. This operation prevents
  // the compiler from creating a temporary variable to hold
  // it.
  pushLiteral: function(value) {
    this.pushStackLiteral(value);
  },

  // [pushProgram]
  //
  // On stack, before: ...
  // On stack, after: program(guid), ...
  //
  // Push a program expression onto the stack. This takes
  // a compile-time guid and converts it into a runtime-accessible
  // expression.
  pushProgram: function(guid) {
    if (guid != null) {
      this.pushStackLiteral(this.programExpression(guid));
    } else {
      this.pushStackLiteral(null);
    }
  },

  // [invokeHelper]
  //
  // On stack, before: hash, inverse, program, params..., ...
  // On stack, after: result of helper invocation
  //
  // Pops off the helper's parameters, invokes the helper,
  // and pushes the helper's return value onto the stack.
  //
  // If the helper is not found, `helperMissing` is called.
  invokeHelper: function(paramSize, name) {
    this.context.aliases.helperMissing = 'helpers.helperMissing';

    var helper = this.lastHelper = this.setupHelper(paramSize, name, true);
    var nonHelper = this.nameLookup('depth' + this.lastContext, name, 'context');

    this.push(helper.name + ' || ' + nonHelper);
    this.replaceStack(function(name) {
      return name + ' ? ' + name + '.call(' +
          helper.callParams + ") " + ": helperMissing.call(" +
          helper.helperMissingParams + ")";
    });
  },

  // [invokeKnownHelper]
  //
  // On stack, before: hash, inverse, program, params..., ...
  // On stack, after: result of helper invocation
  //
  // This operation is used when the helper is known to exist,
  // so a `helperMissing` fallback is not required.
  invokeKnownHelper: function(paramSize, name) {
    var helper = this.setupHelper(paramSize, name);
    this.push(helper.name + ".call(" + helper.callParams + ")");
  },

  // [invokeAmbiguous]
  //
  // On stack, before: hash, inverse, program, params..., ...
  // On stack, after: result of disambiguation
  //
  // This operation is used when an expression like `{{foo}}`
  // is provided, but we don't know at compile-time whether it
  // is a helper or a path.
  //
  // This operation emits more code than the other options,
  // and can be avoided by passing the `knownHelpers` and
  // `knownHelpersOnly` flags at compile-time.
  invokeAmbiguous: function(name, helperCall) {
    this.context.aliases.functionType = '"function"';

    this.pushStackLiteral('{}');    // Hash value
    var helper = this.setupHelper(0, name, helperCall);

    var helperName = this.lastHelper = this.nameLookup('helpers', name, 'helper');

    var nonHelper = this.nameLookup('depth' + this.lastContext, name, 'context');
    var nextStack = this.nextStack();

    this.source.push('if (' + nextStack + ' = ' + helperName + ') { ' + nextStack + ' = ' + nextStack + '.call(' + helper.callParams + '); }');
    this.source.push('else { ' + nextStack + ' = ' + nonHelper + '; ' + nextStack + ' = typeof ' + nextStack + ' === functionType ? ' + nextStack + '.apply(depth0) : ' + nextStack + '; }');
  },

  // [invokePartial]
  //
  // On stack, before: context, ...
  // On stack after: result of partial invocation
  //
  // This operation pops off a context, invokes a partial with that context,
  // and pushes the result of the invocation back.
  invokePartial: function(name) {
    var params = [this.nameLookup('partials', name, 'partial'), "'" + name + "'", this.popStack(), "helpers", "partials"];

    if (this.options.data) {
      params.push("data");
    }

    this.context.aliases.self = "this";
    this.push("self.invokePartial(" + params.join(", ") + ")");
  },

  // [assignToHash]
  //
  // On stack, before: value, hash, ...
  // On stack, after: hash, ...
  //
  // Pops a value and hash off the stack, assigns `hash[key] = value`
  // and pushes the hash back onto the stack.
  assignToHash: function(key) {
    var value = this.popStack(),
        context,
        type;

    if (this.options.stringParams) {
      type = this.popStack();
      context = this.popStack();
    }

    var hash = this.hash;
    if (context) {
      hash.contexts.push("'" + key + "': " + context);
    }
    if (type) {
      hash.types.push("'" + key + "': " + type);
    }
    hash.values.push("'" + key + "': (" + value + ")");
  },

  // HELPERS

  compiler: JavaScriptCompiler,

  compileChildren: function(environment, options) {
    var children = environment.children, child, compiler;

    for(var i=0, l=children.length; i<l; i++) {
      child = children[i];
      compiler = new this.compiler();

      var index = this.matchExistingProgram(child);

      if (index == null) {
        this.context.programs.push('');     // Placeholder to prevent name conflicts for nested children
        index = this.context.programs.length;
        child.index = index;
        child.name = 'program' + index;
        this.context.programs[index] = compiler.compile(child, options, this.context);
        this.context.environments[index] = child;
      } else {
        child.index = index;
        child.name = 'program' + index;
      }
    }
  },
  matchExistingProgram: function(child) {
    for (var i = 0, len = this.context.environments.length; i < len; i++) {
      var environment = this.context.environments[i];
      if (environment && environment.equals(child)) {
        return i;
      }
    }
  },

  programExpression: function(guid) {
    this.context.aliases.self = "this";

    if(guid == null) {
      return "self.noop";
    }

    var child = this.environment.children[guid],
        depths = child.depths.list, depth;

    var programParams = [child.index, child.name, "data"];

    for(var i=0, l = depths.length; i<l; i++) {
      depth = depths[i];

      if(depth === 1) { programParams.push("depth0"); }
      else { programParams.push("depth" + (depth - 1)); }
    }

    return (depths.length === 0 ? "self.program(" : "self.programWithDepth(") + programParams.join(", ") + ")";
  },

  register: function(name, val) {
    this.useRegister(name);
    this.source.push(name + " = " + val + ";");
  },

  useRegister: function(name) {
    if(!this.registers[name]) {
      this.registers[name] = true;
      this.registers.list.push(name);
    }
  },

  pushStackLiteral: function(item) {
    return this.push(new Literal(item));
  },

  pushStack: function(item) {
    this.flushInline();

    var stack = this.incrStack();
    if (item) {
      this.source.push(stack + " = " + item + ";");
    }
    this.compileStack.push(stack);
    return stack;
  },

  replaceStack: function(callback) {
    var prefix = '',
        inline = this.isInline(),
        stack;

    // If we are currently inline then we want to merge the inline statement into the
    // replacement statement via ','
    if (inline) {
      var top = this.popStack(true);

      if (top instanceof Literal) {
        // Literals do not need to be inlined
        stack = top.value;
      } else {
        // Get or create the current stack name for use by the inline
        var name = this.stackSlot ? this.topStackName() : this.incrStack();

        prefix = '(' + this.push(name) + ' = ' + top + '),';
        stack = this.topStack();
      }
    } else {
      stack = this.topStack();
    }

    var item = callback.call(this, stack);

    if (inline) {
      if (this.inlineStack.length || this.compileStack.length) {
        this.popStack();
      }
      this.push('(' + prefix + item + ')');
    } else {
      // Prevent modification of the context depth variable. Through replaceStack
      if (!/^stack/.test(stack)) {
        stack = this.nextStack();
      }

      this.source.push(stack + " = (" + prefix + item + ");");
    }
    return stack;
  },

  nextStack: function() {
    return this.pushStack();
  },

  incrStack: function() {
    this.stackSlot++;
    if(this.stackSlot > this.stackVars.length) { this.stackVars.push("stack" + this.stackSlot); }
    return this.topStackName();
  },
  topStackName: function() {
    return "stack" + this.stackSlot;
  },
  flushInline: function() {
    var inlineStack = this.inlineStack;
    if (inlineStack.length) {
      this.inlineStack = [];
      for (var i = 0, len = inlineStack.length; i < len; i++) {
        var entry = inlineStack[i];
        if (entry instanceof Literal) {
          this.compileStack.push(entry);
        } else {
          this.pushStack(entry);
        }
      }
    }
  },
  isInline: function() {
    return this.inlineStack.length;
  },

  popStack: function(wrapped) {
    var inline = this.isInline(),
        item = (inline ? this.inlineStack : this.compileStack).pop();

    if (!wrapped && (item instanceof Literal)) {
      return item.value;
    } else {
      if (!inline) {
        this.stackSlot--;
      }
      return item;
    }
  },

  topStack: function(wrapped) {
    var stack = (this.isInline() ? this.inlineStack : this.compileStack),
        item = stack[stack.length - 1];

    if (!wrapped && (item instanceof Literal)) {
      return item.value;
    } else {
      return item;
    }
  },

  quotedString: function(str) {
    return '"' + str
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\u2028/g, '\\u2028')   // Per Ecma-262 7.3 + 7.8.4
      .replace(/\u2029/g, '\\u2029') + '"';
  },

  setupHelper: function(paramSize, name, missingParams) {
    var params = [];
    this.setupParams(paramSize, params, missingParams);
    var foundHelper = this.nameLookup('helpers', name, 'helper');

    return {
      params: params,
      name: foundHelper,
      callParams: ["depth0"].concat(params).join(", "),
      helperMissingParams: missingParams && ["depth0", this.quotedString(name)].concat(params).join(", ")
    };
  },

  // the params and contexts arguments are passed in arrays
  // to fill in
  setupParams: function(paramSize, params, useRegister) {
    var options = [], contexts = [], types = [], param, inverse, program;

    options.push("hash:" + this.popStack());

    inverse = this.popStack();
    program = this.popStack();

    // Avoid setting fn and inverse if neither are set. This allows
    // helpers to do a check for `if (options.fn)`
    if (program || inverse) {
      if (!program) {
        this.context.aliases.self = "this";
        program = "self.noop";
      }

      if (!inverse) {
       this.context.aliases.self = "this";
        inverse = "self.noop";
      }

      options.push("inverse:" + inverse);
      options.push("fn:" + program);
    }

    for(var i=0; i<paramSize; i++) {
      param = this.popStack();
      params.push(param);

      if(this.options.stringParams) {
        types.push(this.popStack());
        contexts.push(this.popStack());
      }
    }

    if (this.options.stringParams) {
      options.push("contexts:[" + contexts.join(",") + "]");
      options.push("types:[" + types.join(",") + "]");
      options.push("hashContexts:hashContexts");
      options.push("hashTypes:hashTypes");
    }

    if(this.options.data) {
      options.push("data:data");
    }

    options = "{" + options.join(",") + "}";
    if (useRegister) {
      this.register('options', options);
      params.push('options');
    } else {
      params.push(options);
    }
    return params.join(", ");
  }
};

var reservedWords = (
  "break else new var" +
  " case finally return void" +
  " catch for switch while" +
  " continue function this with" +
  " default if throw" +
  " delete in try" +
  " do instanceof typeof" +
  " abstract enum int short" +
  " boolean export interface static" +
  " byte extends long super" +
  " char final native synchronized" +
  " class float package throws" +
  " const goto private transient" +
  " debugger implements protected volatile" +
  " double import public let yield"
).split(" ");

var compilerWords = JavaScriptCompiler.RESERVED_WORDS = {};

for(var i=0, l=reservedWords.length; i<l; i++) {
  compilerWords[reservedWords[i]] = true;
}

JavaScriptCompiler.isValidJavaScriptVariableName = function(name) {
  if(!JavaScriptCompiler.RESERVED_WORDS[name] && /^[a-zA-Z_$][0-9a-zA-Z_$]+$/.test(name)) {
    return true;
  }
  return false;
};

Handlebars.precompile = function(input, options) {
  if (input == null || (typeof input !== 'string' && input.constructor !== Handlebars.AST.ProgramNode)) {
    throw new Handlebars.Exception("You must pass a string or Handlebars AST to Handlebars.precompile. You passed " + input);
  }

  options = options || {};
  if (!('data' in options)) {
    options.data = true;
  }
  var ast = Handlebars.parse(input);
  var environment = new Compiler().compile(ast, options);
  return new JavaScriptCompiler().compile(environment, options);
};

Handlebars.compile = function(input, options) {
  if (input == null || (typeof input !== 'string' && input.constructor !== Handlebars.AST.ProgramNode)) {
    throw new Handlebars.Exception("You must pass a string or Handlebars AST to Handlebars.compile. You passed " + input);
  }

  options = options || {};
  if (!('data' in options)) {
    options.data = true;
  }
  var compiled;
  function compile() {
    var ast = Handlebars.parse(input);
    var environment = new Compiler().compile(ast, options);
    var templateSpec = new JavaScriptCompiler().compile(environment, options, undefined, true);
    return Handlebars.template(templateSpec);
  }

  // Template is only compiled on first use and cached after that point.
  return function(context, options) {
    if (!compiled) {
      compiled = compile();
    }
    return compiled.call(this, context, options);
  };
};

;
// lib/handlebars/runtime.js

Handlebars.VM = {
  template: function(templateSpec) {
    // Just add water
    var container = {
      escapeExpression: Handlebars.Utils.escapeExpression,
      invokePartial: Handlebars.VM.invokePartial,
      programs: [],
      program: function(i, fn, data) {
        var programWrapper = this.programs[i];
        if(data) {
          programWrapper = Handlebars.VM.program(i, fn, data);
        } else if (!programWrapper) {
          programWrapper = this.programs[i] = Handlebars.VM.program(i, fn);
        }
        return programWrapper;
      },
      merge: function(param, common) {
        var ret = param || common;

        if (param && common) {
          ret = {};
          Handlebars.Utils.extend(ret, common);
          Handlebars.Utils.extend(ret, param);
        }
        return ret;
      },
      programWithDepth: Handlebars.VM.programWithDepth,
      noop: Handlebars.VM.noop,
      compilerInfo: null
    };

    return function(context, options) {
      options = options || {};
      var result = templateSpec.call(container, Handlebars, context, options.helpers, options.partials, options.data);

      var compilerInfo = container.compilerInfo || [],
          compilerRevision = compilerInfo[0] || 1,
          currentRevision = Handlebars.COMPILER_REVISION;

      if (compilerRevision !== currentRevision) {
        if (compilerRevision < currentRevision) {
          var runtimeVersions = Handlebars.REVISION_CHANGES[currentRevision],
              compilerVersions = Handlebars.REVISION_CHANGES[compilerRevision];
          throw "Template was precompiled with an older version of Handlebars than the current runtime. "+
                "Please update your precompiler to a newer version ("+runtimeVersions+") or downgrade your runtime to an older version ("+compilerVersions+").";
        } else {
          // Use the embedded version info since the runtime doesn't know about this revision yet
          throw "Template was precompiled with a newer version of Handlebars than the current runtime. "+
                "Please update your runtime to a newer version ("+compilerInfo[1]+").";
        }
      }

      return result;
    };
  },

  programWithDepth: function(i, fn, data /*, $depth */) {
    var args = Array.prototype.slice.call(arguments, 3);

    var program = function(context, options) {
      options = options || {};

      return fn.apply(this, [context, options.data || data].concat(args));
    };
    program.program = i;
    program.depth = args.length;
    return program;
  },
  program: function(i, fn, data) {
    var program = function(context, options) {
      options = options || {};

      return fn(context, options.data || data);
    };
    program.program = i;
    program.depth = 0;
    return program;
  },
  noop: function() { return ""; },
  invokePartial: function(partial, name, context, helpers, partials, data) {
    var options = { helpers: helpers, partials: partials, data: data };

    if(partial === undefined) {
      throw new Handlebars.Exception("The partial " + name + " could not be found");
    } else if(partial instanceof Function) {
      return partial(context, options);
    } else if (!Handlebars.compile) {
      throw new Handlebars.Exception("The partial " + name + " could not be compiled when running in runtime-only mode");
    } else {
      partials[name] = Handlebars.compile(partial, {data: data !== undefined});
      return partials[name](context, options);
    }
  }
};

Handlebars.template = Handlebars.VM.template;
;
// lib/handlebars/browser-suffix.js
})(Handlebars);
;

define("handlebars", (function (global) {
    return function () {
        var ret, fn;
        return ret || global.Handlebars;
    };
}(this)));

/*
Copyright (c) 2011-2013 @WalmartLabs

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to
deal in the Software without restriction, including without limitation the
rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
*/

;;
(function() {

/*global cloneInheritVars, createInheritVars, resetInheritVars, createRegistryWrapper, getValue, inheritVars, createErrorMessage */

//support zepto.forEach on jQuery
if (!$.fn.forEach) {
  $.fn.forEach = function(iterator, context) {
    $.fn.each.call(this, function(index) {
      iterator.call(context || this, this, index);
    });
  };
}

var viewNameAttributeName = 'data-view-name',
    viewCidAttributeName = 'data-view-cid',
    viewHelperAttributeName = 'data-view-helper';

//view instances
var viewsIndexedByCid = {};

if (!Handlebars.templates) {
  Handlebars.templates = {};
}

var Thorax = this.Thorax = {
  templatePathPrefix: '',
  //view classes
  Views: {},
  //certain error prone pieces of code (on Android only it seems)
  //are wrapped in a try catch block, then trigger this handler in
  //the catch, with the name of the function or event that was
  //trying to be executed. Override this with a custom handler
  //to debug / log / etc
  onException: function(name, err) {
    throw err;
  },
  //deprecated, here to ensure existing projects aren't mucked with
  templates: Handlebars.templates
};

Thorax.View = Backbone.View.extend({
  constructor: function() {
    var response = Backbone.View.apply(this, arguments);
    _.each(inheritVars, function(obj) {
      if (obj.ctor) {
        obj.ctor.call(this, response);
      }
    }, this);
    return response;
  },
  _configure: function(options) {
    var self = this;

    this._referenceCount = 0;

    this._objectOptionsByCid = {};
    this._boundDataObjectsByCid = {};

    // Setup object event tracking
    _.each(inheritVars, function(obj) {
      self[obj.name] = [];
    });

    viewsIndexedByCid[this.cid] = this;
    this.children = {};
    this._renderCount = 0;

    //this.options is removed in Thorax.View, we merge passed
    //properties directly with the view and template context
    _.extend(this, options || {});

    // Setup helpers
    bindHelpers.call(this);

    _.each(inheritVars, function(obj) {
      if (obj.configure) {
        obj.configure.call(this);
      }
    }, this);

    this.trigger('configure');
  },

  setElement : function() {
    var response = Backbone.View.prototype.setElement.apply(this, arguments);
    this.name && this.$el.attr(viewNameAttributeName, this.name);
    this.$el.attr(viewCidAttributeName, this.cid);
    return response;
  },

  _addChild: function(view) {
    if (this.children[view.cid]) {
      return view;
    }
    view.retain();
    this.children[view.cid] = view;
    // _helperOptions is used to detect if is HelperView
    // we do not want to remove child in this case as
    // we are adding the HelperView to the declaring view
    // (whatever view used the view helper in it's template)
    // but it's parent will not equal the declaring view
    // in the case of a nested helper, which will cause an error.
    // In either case it's not necessary to ever call
    // _removeChild on a HelperView as _addChild should only
    // be called when a HelperView is created.
    if (view.parent && view.parent !== this && !view._helperOptions) {
      view.parent._removeChild(view);
    }
    view.parent = this;
    this.trigger('child', view);
    return view;
  },

  _removeChild: function(view) {
    delete this.children[view.cid];
    view.parent = null;
    view.release();
    return view;
  },

  _destroy: function(options) {
    _.each(this._boundDataObjectsByCid, this.unbindDataObject, this);
    this.trigger('destroyed');
    delete viewsIndexedByCid[this.cid];

    _.each(this.children, function(child) {
      this._removeChild(child);
    }, this);

    if (this.el) {
      this.undelegateEvents();
      this.remove();  // Will call stopListening()
      this.off();     // Kills off remaining events
    }

    // Absolute worst case scenario, kill off some known fields to minimize the impact
    // of being retained.
    this.el = this.$el = undefined;
    this.parent = undefined;
    this.model = this.collection = this._collection = undefined;
    this._helperOptions = undefined;
  },

  render: function(output) {
    // NOP for destroyed views
    if (!this.el) {
      return;
    }

    if (this._rendering) {
      // Nested rendering of the same view instances can lead to some very nasty issues with
      // the root render process overwriting any updated data that may have been output in the child
      // execution. If in a situation where you need to rerender in response to an event that is
      // triggered sync in the rendering lifecycle it's recommended to defer the subsequent render
      // or refactor so that all preconditions are known prior to exec.
      throw new Error(createErrorMessage('nested-render'));
    }

    this._previousHelpers = _.filter(this.children, function(child) {
      return child._helperOptions;
    });

    var children = {};
    _.each(this.children, function(child, key) {
      if (!child._helperOptions) {
        children[key] = child;
      }
    });
    this.children = children;

    this.trigger('before:rendered');
    this._rendering = true;

    try {
      if (_.isUndefined(output) || (!_.isElement(output) && !Thorax.Util.is$(output) && !(output && output.el) && !_.isString(output) && !_.isFunction(output))) {
        // try one more time to assign the template, if we don't
        // yet have one we must raise
        assignTemplate.call(this, 'template', {
          required: true
        });
        output = this.renderTemplate(this.template);
      } else if (_.isFunction(output)) {
        output = this.renderTemplate(output);
      }

      // Destroy any helpers that may be lingering
      _.each(this._previousHelpers, function(child) {
        this._removeChild(child);
      }, this);
      this._previousHelpers = undefined;

      //accept a view, string, Handlebars.SafeString or DOM element
      this.html((output && output.el) || (output && output.string) || output);

      ++this._renderCount;
      this.trigger('rendered');
    } finally {
      this._rendering = false;
    }

    return output;
  },

  context: function() {
    return _.extend({}, (this.model && this.model.attributes) || {});
  },

  _getContext: function() {
    return _.extend({}, this, getValue(this, 'context') || {});
  },

  // Private variables in handlebars / options.data in template helpers
  _getData: function(data) {
    return {
      view: this,
      cid: _.uniqueId('t'),
      yield: function() {
        // fn is seeded by template helper passing context to data
        return data.fn && data.fn(data);
      }
    };
  },

  renderTemplate: function(file, context, ignoreErrors) {
    var template;
    context = context || this._getContext();
    if (_.isFunction(file)) {
      template = file;
    } else {
      template = Thorax.Util.getTemplate(file, ignoreErrors);
    }
    if (!template) {
      return '';
    } else {
      return template(context, {
        helpers: this.helpers,
        data: this._getData(context)
      });
    }
  },

  ensureRendered: function() {
    !this._renderCount && this.render();
  },
  shouldRender: function(flag) {
    // Render if flag is truthy or if we have already rendered and flag is undefined/null
    return flag || (flag == null && this._renderCount);
  },
  conditionalRender: function(flag) {
    if (this.shouldRender(flag)) {
      this.render();
    }
  },

  appendTo: function(el) {
    this.ensureRendered();
    $(el).append(this.el);
    this.trigger('ready', {target: this});
  },

  html: function(html) {
    if (_.isUndefined(html)) {
      return this.el.innerHTML;
    } else {
      // Event for IE element fixes
      this.trigger('before:append');
      var element = this._replaceHTML(html);
      this.trigger('append');
      return element;
    }
  },

  release: function() {
    --this._referenceCount;
    if (this._referenceCount <= 0) {
      this._destroy();
    }
  },

  retain: function(owner) {
    ++this._referenceCount;
    if (owner) {
      // Not using listenTo helper as we want to run once the owner is destroyed
      this.listenTo(owner, 'destroyed', owner.release);
    }
  },

  _replaceHTML: function(html) {
    this.el.innerHTML = "";
    return this.$el.append(html);
  },

  _anchorClick: function(event) {
    var target = $(event.currentTarget),
        href = target.attr('href');
    // Route anything that starts with # or / (excluding //domain urls)
    if (href && (href[0] === '#' || (href[0] === '/' && href[1] !== '/'))) {
      Backbone.history.navigate(href, {
        trigger: true
      });
      return false;
    }
    return true;
  }
});

Thorax.View.extend = function() {
  createInheritVars(this);

  var child = Backbone.View.extend.apply(this, arguments);
  child.__parent__ = this;

  resetInheritVars(child);

  return child;
};

createRegistryWrapper(Thorax.View, Thorax.Views);

function bindHelpers() {
  if (this.helpers) {
    _.each(this.helpers, function(helper, name) {
      var view = this;
      this.helpers[name] = function() {
        var args = _.toArray(arguments),
            options = _.last(args);
        options.context = this;
        return helper.apply(view, args);
      };
    }, this);
  }
}

//$(selector).view() helper
$.fn.view = function(options) {
  options = _.defaults(options || {}, {
    helper: true
  });
  var selector = '[' + viewCidAttributeName + ']';
  if (!options.helper) {
    selector += ':not([' + viewHelperAttributeName + '])';
  }
  var el = $(this).closest(selector);
  return (el && viewsIndexedByCid[el.attr(viewCidAttributeName)]) || false;
};

;;
/*global createRegistryWrapper:true, cloneEvents: true */
function createErrorMessage(code) {
  return 'Error "' + code + '". For more information visit http://thoraxjs.org/error-codes.html' + '#' + code;
}

function createRegistryWrapper(klass, hash) {
  var $super = klass.extend;
  klass.extend = function() {
    var child = $super.apply(this, arguments);
    if (child.prototype.name) {
      hash[child.prototype.name] = child;
    }
    return child;
  };
}

function registryGet(object, type, name, ignoreErrors) {
  var target = object[type],
      value;
  if (_.indexOf(name, '.') >= 0) {
    var bits = name.split(/\./);
    name = bits.pop();
    _.each(bits, function(key) {
      target = target[key];
    });
  }
  target && (value = target[name]);
  if (!value && !ignoreErrors) {
    throw new Error(type + ': ' + name + ' does not exist.');
  } else {
    return value;
  }
}

function assignView(attributeName, options) {
  var ViewClass;
  // if attribute is the name of view to fetch
  if (_.isString(this[attributeName])) {
    ViewClass = Thorax.Util.getViewClass(this[attributeName], true);
  // else try and fetch the view based on the name
  } else if (this.name && !_.isFunction(this[attributeName])) {
    ViewClass = Thorax.Util.getViewClass(this.name + (options.extension || ''), true);
  }
  // if we found something, assign it
  if (ViewClass && !_.isFunction(this[attributeName])) {
    this[attributeName] = ViewClass;
  }
  // if nothing was found and it's required, throw
  if (options.required && !_.isFunction(this[attributeName])) {
    throw new Error('View ' + (this.name || this.cid) + ' requires: ' + attributeName);
  }
}

function assignTemplate(attributeName, options) {
  var template;
  // if attribute is the name of template to fetch
  if (_.isString(this[attributeName])) {
    template = Thorax.Util.getTemplate(this[attributeName], true);
  // else try and fetch the template based on the name
  } else if (this.name && !_.isFunction(this[attributeName])) {
    template = Thorax.Util.getTemplate(this.name + (options.extension || ''), true);
  }
  // CollectionView and LayoutView have a defaultTemplate that may be used if none
  // was found, regular views must have a template if render() is called
  if (!template && attributeName === 'template' && this._defaultTemplate) {
    template = this._defaultTemplate;
  }
  // if we found something, assign it
  if (template && !_.isFunction(this[attributeName])) {
    this[attributeName] = template;
  }
  // if nothing was found and it's required, throw
  if (options.required && !_.isFunction(this[attributeName])) {
    throw new Error('View ' + (this.name || this.cid) + ' requires: ' + attributeName);
  }
}

// getValue is used instead of _.result because we
// need an extra scope parameter, and will minify
// better than _.result
function getValue(object, prop, scope) {
  if (!(object && object[prop])) {
    return null;
  }
  return _.isFunction(object[prop])
    ? object[prop].call(scope || object)
    : object[prop];
}

var inheritVars = {};
function createInheritVars(self) {
  // Ensure that we have our static event objects
  _.each(inheritVars, function(obj) {
    if (!self[obj.name]) {
      self[obj.name] = [];
    }
  });
}
function resetInheritVars(self) {
  // Ensure that we have our static event objects
  _.each(inheritVars, function(obj) {
    self[obj.name] = [];
  });
}
function walkInheritTree(source, fieldName, isStatic, callback) {
  var tree = [];
  if (_.has(source, fieldName)) {
    tree.push(source);
  }
  var iterate = source;
  if (isStatic) {
    while (iterate = iterate.__parent__) {
      if (_.has(iterate, fieldName)) {
        tree.push(iterate);
      }
    }
  } else {
    iterate = iterate.constructor;
    while (iterate) {
      if (iterate.prototype && _.has(iterate.prototype, fieldName)) {
        tree.push(iterate.prototype);
      }
      iterate = iterate.__super__ && iterate.__super__.constructor;
    }
  }

  var i = tree.length;
  while (i--) {
    _.each(getValue(tree[i], fieldName, source), callback);
  }
}

function objectEvents(target, eventName, callback, context) {
  if (_.isObject(callback)) {
    var spec = inheritVars[eventName];
    if (spec && spec.event) {
      if (target && target.listenTo && target[eventName] && target[eventName].cid) {
        addEvents(target, callback, context, eventName);
      } else {
        addEvents(target['_' + eventName + 'Events'], callback, context);
      }
      return true;
    }
  }
}
// internal listenTo function will error on destroyed
// race condition
function listenTo(object, target, eventName, callback, context) {
  // getEventCallback will resolve if it is a string or a method
  // and return a method
  var callbackMethod = getEventCallback(callback, object),
      destroyedCount = 0;

  function eventHandler() {
    if (object.el) {
      callbackMethod.apply(context, arguments);
    } else {
      // If our event handler is removed by destroy while another event is processing then we
      // we might see one latent event percolate through due to caching in the event loop. If we
      // see multiple events this is a concern and a sign that something was not cleaned properly.
      if (destroyedCount) {
        throw new Error('destroyed-event:' + object.name + ':' + eventName);
      }
      destroyedCount++;
    }
  }
  eventHandler._callback = callbackMethod._callback || callbackMethod;
  eventHandler._thoraxBind = true;
  object.listenTo(target, eventName, eventHandler);
}

function addEvents(target, source, context, listenToObject) {
  function addEvent(callback, eventName) {
    if (listenToObject) {
      listenTo(target, target[listenToObject], eventName, callback, context || target);
    } else {
      target.push([eventName, callback, context]);
    }
  }

  _.each(source, function(callback, eventName) {
    if (_.isArray(callback)) {
      _.each(callback, function(cb) {
        addEvent(cb, eventName);
      });
    } else {
      addEvent(callback, eventName);
    }
  });
}

function getOptionsData(options) {
  if (!options || !options.data) {
    throw new Error(createErrorMessage('handlebars-no-data'));
  }
  return options.data;
}

// In helpers "tagName" or "tag" may be specified, as well
// as "class" or "className". Normalize to "tagName" and
// "className" to match the property names used by Backbone
// jQuery, etc. Special case for "className" in
// Thorax.Util.tag: will be rewritten as "class" in
// generated HTML.
function normalizeHTMLAttributeOptions(options) {
  if (options.tag) {
    options.tagName = options.tag;
    delete options.tag;
  }
  if (options['class']) {
    options.className = options['class'];
    delete options['class'];
  }
}

Thorax.Util = {
  getViewInstance: function(name, attributes) {
    var ViewClass = Thorax.Util.getViewClass(name, true);
    return ViewClass ? new ViewClass(attributes || {}) : name;
  },

  getViewClass: function(name, ignoreErrors) {
    if (_.isString(name)) {
      return registryGet(Thorax, 'Views', name, ignoreErrors);
    } else if (_.isFunction(name)) {
      return name;
    } else {
      return false;
    }
  },

  getTemplate: function(file, ignoreErrors) {
    //append the template path prefix if it is missing
    var pathPrefix = Thorax.templatePathPrefix,
        template;
    if (pathPrefix && file.substr(0, pathPrefix.length) !== pathPrefix) {
      file = pathPrefix + file;
    }

    // Without extension
    file = file.replace(/\.handlebars$/, '');
    template = Handlebars.templates[file];
    if (!template) {
      // With extension
      file = file + '.handlebars';
      template = Handlebars.templates[file];
    }

    if (!template && !ignoreErrors) {
      throw new Error('templates: ' + file + ' does not exist.');
    }
    return template;
  },

  //'selector' is not present in $('<p></p>')
  //TODO: investigage a better detection method
  is$: function(obj) {
    return _.isObject(obj) && ('length' in obj);
  },
  expandToken: function(input, scope) {
    if (input && input.indexOf && input.indexOf('{{') >= 0) {
      var re = /(?:\{?[^{]+)|(?:\{\{([^}]+)\}\})/g,
          match,
          ret = [];
      function deref(token, scope) {
        if (token.match(/^("|')/) && token.match(/("|')$/)) {
          return token.replace(/(^("|')|('|")$)/g, '');
        }
        var segments = token.split('.'),
            len = segments.length;
        for (var i = 0; scope && i < len; i++) {
          if (segments[i] !== 'this') {
            scope = scope[segments[i]];
          }
        }
        return scope;
      }
      while (match = re.exec(input)) {
        if (match[1]) {
          var params = match[1].split(/\s+/);
          if (params.length > 1) {
            var helper = params.shift();
            params = _.map(params, function(param) { return deref(param, scope); });
            if (Handlebars.helpers[helper]) {
              ret.push(Handlebars.helpers[helper].apply(scope, params));
            } else {
              // If the helper is not defined do nothing
              ret.push(match[0]);
            }
          } else {
            ret.push(deref(params[0], scope));
          }
        } else {
          ret.push(match[0]);
        }
      }
      input = ret.join('');
    }
    return input;
  },
  tag: function(attributes, content, scope) {
    var htmlAttributes = _.omit(attributes, 'tagName'),
        tag = attributes.tagName || 'div';
    return '<' + tag + ' ' + _.map(htmlAttributes, function(value, key) {
      if (_.isUndefined(value) || key === 'expand-tokens') {
        return '';
      }
      var formattedValue = value;
      if (scope) {
        formattedValue = Thorax.Util.expandToken(value, scope);
      }
      return (key === 'className' ? 'class' : key) + '="' + Handlebars.Utils.escapeExpression(formattedValue) + '"';
    }).join(' ') + '>' + (_.isUndefined(content) ? '' : content) + '</' + tag + '>';
  }
};

;;
Thorax.Mixins = {};

_.extend(Thorax.View, {
  mixin: function(name) {
    Thorax.Mixins[name](this);
  },
  registerMixin: function(name, callback, methods) {
    Thorax.Mixins[name] = function(obj) {
      var isInstance = !!obj.cid;
      if (methods) {
        _.extend(isInstance ? obj : obj.prototype, methods);
      }
      if (isInstance) {
        callback.call(obj);
      } else {
        obj.on('configure', callback);
      }
    };
  }
});

Thorax.View.prototype.mixin = function(name) {
  Thorax.Mixins[name](this);
};

;;
/*global createInheritVars, inheritVars, listenTo, objectEvents, walkInheritTree */
// Save a copy of the _on method to call as a $super method
var _on = Thorax.View.prototype.on;

inheritVars.event = {
  name: '_events',

  configure: function() {
    var self = this;
    walkInheritTree(this.constructor, '_events', true, function(event) {
      self.on.apply(self, event);
    });
    walkInheritTree(this, 'events', false, function(handler, eventName) {
      self.on(eventName, handler, self);
    });
  }
};

_.extend(Thorax.View, {
  on: function(eventName, callback) {
    createInheritVars(this);

    if (objectEvents(this, eventName, callback)) {
      return this;
    }

    //accept on({"rendered": handler})
    if (_.isObject(eventName)) {
      _.each(eventName, function(value, key) {
        this.on(key, value);
      }, this);
    } else {
      //accept on({"rendered": [handler, handler]})
      if (_.isArray(callback)) {
        _.each(callback, function(cb) {
          this._events.push([eventName, cb]);
        }, this);
      //accept on("rendered", handler)
      } else {
        this._events.push([eventName, callback]);
      }
    }
    return this;
  }
});

_.extend(Thorax.View.prototype, {
  on: function(eventName, callback, context) {
    if (objectEvents(this, eventName, callback, context)) {
      return this;
    }

    if (_.isObject(eventName) && arguments.length < 3) {
      //accept on({"rendered": callback})
      _.each(eventName, function(value, key) {
        this.on(key, value, callback || this);    // callback is context in this form of the call
      }, this);
    } else {
      //accept on("rendered", callback, context)
      //accept on("click a", callback, context)
      _.each((_.isArray(callback) ? callback : [callback]), function(callback) {
        var params = eventParamsFromEventItem.call(this, eventName, callback, context || this);
        if (params.type === 'DOM' && !this._eventsDelegated) {
          //will call _addEvent during delegateEvents()
          if (!this._eventsToDelegate) {
            this._eventsToDelegate = [];
          }
          this._eventsToDelegate.push(params);
        } else {
          this._addEvent(params);
        }
      }, this);
    }
    return this;
  },
  delegateEvents: function(events) {
    this.undelegateEvents();
    if (events) {
      if (_.isFunction(events)) {
        events = events.call(this);
      }
      this._eventsToDelegate = [];
      this.on(events);
    }
    this._eventsToDelegate && _.each(this._eventsToDelegate, this._addEvent, this);
    this._eventsDelegated = true;
  },
  //params may contain:
  //- name
  //- originalName
  //- selector
  //- type "view" || "DOM"
  //- handler
  _addEvent: function(params) {
    // If this is recursvie due to listenTo delegate below then pass through to super class
    if (params.handler._thoraxBind) {
      return _on.call(this, params.name, params.handler, params.context || this);
    }

    var boundHandler = bindEventHandler.call(this, params.type + '-event:', params);

    if (params.type === 'view') {
      // If we have our context set to an outside view then listen rather than directly bind so
      // we can cleanup properly.
      if (params.context && params.context !== this && params.context instanceof Thorax.View) {
        listenTo(params.context, this, params.name, boundHandler, params.context);
      } else {
        _on.call(this, params.name, boundHandler, params.context || this);
      }
    } else {
      if (!params.nested) {
        boundHandler = containHandlerToCurentView(boundHandler, this.cid);
      }

      var name = params.name + '.delegateEvents' + this.cid;
      if (params.selector) {
        this.$el.on(name, params.selector, boundHandler);
      } else {
        this.$el.on(name, boundHandler);
      }
    }
  }
});

Thorax.View.prototype.bind = Thorax.View.prototype.on;

// When view is ready trigger ready event on all
// children that are present, then register an
// event that will trigger ready on new children
// when they are added
Thorax.View.on('ready', function(options) {
  if (!this._isReady) {
    this._isReady = true;
    function triggerReadyOnChild(child) {
      child._isReady || child.trigger('ready', options);
    }
    _.each(this.children, triggerReadyOnChild);
    this.on('child', triggerReadyOnChild);
  }
});

var eventSplitter = /^(nested\s+)?(\S+)(?:\s+(.+))?/;

var domEvents = [],
    domEventRegexp;
function pushDomEvents(events) {
  domEvents.push.apply(domEvents, events);
  domEventRegexp = new RegExp('^(nested\\s+)?(' + domEvents.join('|') + ')(?:\\s|$)');
}
pushDomEvents([
  'mousedown', 'mouseup', 'mousemove', 'mouseover', 'mouseout',
  'touchstart', 'touchend', 'touchmove',
  'click', 'dblclick',
  'keyup', 'keydown', 'keypress',
  'submit', 'change',
  'focus', 'blur'
]);

function containHandlerToCurentView(handler, cid) {
  return function(event) {
    var view = $(event.target).view({helper: false});
    if (view && view.cid === cid) {
      event.originalContext = this;
      handler(event);
    }
  };
}

function bindEventHandler(eventName, params) {
  eventName += params.originalName;

  var callback = params.handler,
      method = _.isFunction(callback) ? callback : this[callback];
  if (!method) {
    throw new Error('Event "' + callback + '" does not exist ' + (this.name || this.cid) + ':' + eventName);
  }

  var context = params.context || this;
  function ret() {
    try {
      method.apply(context, arguments);
    } catch (e) {
      Thorax.onException('thorax-exception: ' + (context.name || context.cid) + ':' + eventName, e);
    }
  }
  // Backbone will delegate to _callback in off calls so we should still be able to support
  // calling off on specific handlers.
  ret._callback = method;
  ret._thoraxBind = true;
  return ret;
}

function eventParamsFromEventItem(name, handler, context) {
  var params = {
    originalName: name,
    handler: _.isString(handler) ? this[handler] : handler
  };
  if (name.match(domEventRegexp)) {
    var match = eventSplitter.exec(name);
    params.nested = !!match[1];
    params.name = match[2];
    params.type = 'DOM';
    params.selector = match[3];
  } else {
    params.name = name;
    params.type = 'view';
  }
  params.context = context;
  return params;
}

;;
/*global getOptionsData, normalizeHTMLAttributeOptions, viewHelperAttributeName */
var viewPlaceholderAttributeName = 'data-view-tmp',
    viewTemplateOverrides = {};

// Will be shared by HelperView and CollectionHelperView
var helperViewPrototype = {
  _ensureElement: function() {
    Thorax.View.prototype._ensureElement.apply(this, arguments);
    this.$el.attr(viewHelperAttributeName, this._helperName);
  },
  _getContext: function() {
    return this.parent._getContext.apply(this.parent, arguments);
  }
};

Thorax.HelperView = Thorax.View.extend(helperViewPrototype);

// Ensure nested inline helpers will always have this.parent
// set to the view containing the template
function getParent(parent) {
  // The `view` helper is a special case as it embeds
  // a view instead of creating a new one
  while (parent._helperName && parent._helperName !== 'view') {
    parent = parent.parent;
  }
  return parent;
}

Handlebars.registerViewHelper = function(name, ViewClass, callback) {
  if (arguments.length === 2) {
    if (ViewClass.factory) {
      callback = ViewClass.callback;
    } else {
      callback = ViewClass;
      ViewClass = Thorax.HelperView;
    }
  }

  var viewOptionWhiteList = ViewClass.attributeWhiteList;

  Handlebars.registerHelper(name, function() {
    var args = _.toArray(arguments),
        options = args.pop(),
        declaringView = getOptionsData(options).view,
        expandTokens = options.hash['expand-tokens'];

    if (expandTokens) {
      delete options.hash['expand-tokens'];
      _.each(options.hash, function(value, key) {
        options.hash[key] = Thorax.Util.expandToken(value, this);
      }, this);
    }

    var viewOptions = {
      inverse: options.inverse,
      options: options.hash,
      declaringView: declaringView,
      parent: getParent(declaringView),
      _helperName: name,
      _helperOptions: {
        options: cloneHelperOptions(options),
        args: _.clone(args)
      }
    };


    normalizeHTMLAttributeOptions(options.hash);
    var htmlAttributes = _.clone(options.hash);
    if (viewOptionWhiteList) {
      _.each(viewOptionWhiteList, function(dest, source) {
        delete htmlAttributes[source];
        if (!_.isUndefined(options.hash[source])) {
          viewOptions[dest] = options.hash[source];
        }
      });
    }
    if(htmlAttributes.tagName) {
      viewOptions.tagName = htmlAttributes.tagName;
    }
    viewOptions.attributes = function() {
      var attrs = (ViewClass.prototype && ViewClass.prototype.attributes) || {};
      if (_.isFunction(attrs)) {
        attrs = attrs.apply(this, arguments);
      }
      _.extend(attrs, _.omit(htmlAttributes, ['tagName']));
      // backbone wants "class"
      if (attrs.className) {
        attrs['class'] = attrs.className;
        delete attrs.className;
      }
      return attrs;
    };

    if (options.fn) {
      // Only assign if present, allow helper view class to
      // declare template
      viewOptions.template = options.fn;
    } else if (ViewClass && ViewClass.prototype && !ViewClass.prototype.template) {
      // ViewClass may also be an instance or object with factory method
      // so need to do this check
      viewOptions.template = Handlebars.VM.noop;
    }

    // Check to see if we have an existing instance that we can reuse
    var instance = _.find(declaringView._previousHelpers, function(child) {
      return compareHelperOptions(viewOptions, child);
    });

    // Create the instance if we don't already have one
    if (!instance) {
      if (ViewClass.factory) {
        instance = ViewClass.factory(args, viewOptions);
        if (!instance) {
          return '';
        }

        instance._helperName = viewOptions._helperName;
        instance._helperOptions = viewOptions._helperOptions;
      } else {
        instance = new ViewClass(viewOptions);
      }

      // Remove any possible entry in previous helpers in case this is a cached value returned from
      // slightly different data that does not qualify for the previous helpers direct reuse.
      // (i.e. when using an array that is modified between renders)
      declaringView._previousHelpers = _.without(declaringView._previousHelpers, instance);

      args.push(instance);
      declaringView._addChild(instance);
      declaringView.trigger.apply(declaringView, ['helper', name].concat(args));
      declaringView.trigger.apply(declaringView, ['helper:' + name].concat(args));

      callback && callback.apply(this, args);
    } else {
      declaringView._previousHelpers = _.without(declaringView._previousHelpers, instance);
      declaringView.children[instance.cid] = instance;
    }

    htmlAttributes[viewPlaceholderAttributeName] = instance.cid;
    if (ViewClass.modifyHTMLAttributes) {
      ViewClass.modifyHTMLAttributes(htmlAttributes, instance);
    }
    return new Handlebars.SafeString(Thorax.Util.tag(htmlAttributes, '', expandTokens ? this : null));
  });
  var helper = Handlebars.helpers[name];
  return helper;
};

Thorax.View.on('append', function(scope, callback) {
  (scope || this.$el).find('[' + viewPlaceholderAttributeName + ']').forEach(function(el) {
    var placeholderId = el.getAttribute(viewPlaceholderAttributeName),
        view = this.children[placeholderId];
    if (view) {
      //see if the view helper declared an override for the view
      //if not, ensure the view has been rendered at least once
      if (viewTemplateOverrides[placeholderId]) {
        view.render(viewTemplateOverrides[placeholderId]);
        delete viewTemplateOverrides[placeholderId];
      } else {
        view.ensureRendered();
      }
      $(el).replaceWith(view.el);
      callback && callback(view.el);
    }
  }, this);
});


/**
 * Clones the helper options, dropping items that are known to change
 * between rendering cycles as appropriate.
 */
function cloneHelperOptions(options) {
  var ret = _.pick(options, 'fn', 'inverse', 'hash', 'data');
  ret.data = _.omit(options.data, 'cid', 'view', 'yield');
  return ret;
}

/**
 * Checks for basic equality between two sets of parameters for a helper view.
 *
 * Checked fields include:
 *  - _helperName
 *  - All args
 *  - Hash
 *  - Data
 *  - Function and Invert (id based if possible)
 *
 * This method allows us to determine if the inputs to a given view are the same. If they
 * are then we make the assumption that the rendering will be the same (or the child view will
 * otherwise rerendering it by monitoring it's parameters as necessary) and reuse the view on
 * rerender of the parent view.
 */
function compareHelperOptions(a, b) {
  function compareValues(a, b) {
    return _.every(a, function(value, key) {
      return b[key] === value;
    });
  }

  if (a._helperName !== b._helperName) {
    return false;
  }

  a = a._helperOptions;
  b = b._helperOptions;

  // Implements a first level depth comparison
  return a.args.length === b.args.length
      && compareValues(a.args, b.args)
      && _.isEqual(_.keys(a.options), _.keys(b.options))
      && _.every(a.options, function(value, key) {
          if (key === 'data' || key === 'hash') {
            return compareValues(a.options[key], b.options[key]);
          } else if (key === 'fn' || key === 'inverse') {
            if (b.options[key] === value) {
              return true;
            }

            var other = b.options[key] || {};
            return value && _.has(value, 'program') && !value.depth && other.program === value.program;
          }
          return b.options[key] === value;
        });
}

;;
/*global getValue, inheritVars, walkInheritTree */

function dataObject(type, spec) {
  spec = inheritVars[type] = _.defaults({
    name: '_' + type + 'Events',
    event: true
  }, spec);

  // Add a callback in the view constructor
  spec.ctor = function() {
    if (this[type]) {
      // Need to null this.model/collection so setModel/Collection will
      // not treat it as the old model/collection and immediately return
      var object = this[type];
      this[type] = null;
      this[spec.set](object);
    }
  };

  function setObject(dataObject, options) {
    var old = this[type],
        $el = getValue(this, spec.$el);

    if (dataObject === old) {
      return this;
    }
    if (old) {
      this.unbindDataObject(old);
    }

    if (dataObject) {
      this[type] = dataObject;

      if (spec.loading) {
        spec.loading.call(this);
      }

      this.bindDataObject(type, dataObject, _.extend({}, this.options, options));
      $el && $el.attr(spec.cidAttrName, dataObject.cid);
      dataObject.trigger('set', dataObject, old);
    } else {
      this[type] = false;
      if (spec.change) {
        spec.change.call(this, false);
      }
      $el && $el.removeAttr(spec.cidAttrName);
    }
    this.trigger('change:data-object', type, dataObject, old);
    return this;
  }

  Thorax.View.prototype[spec.set] = setObject;
}

_.extend(Thorax.View.prototype, {
  getObjectOptions: function(dataObject) {
    return dataObject && this._objectOptionsByCid[dataObject.cid];
  },

  bindDataObject: function(type, dataObject, options) {
    if (this._boundDataObjectsByCid[dataObject.cid]) {
      return false;
    }
    this._boundDataObjectsByCid[dataObject.cid] = dataObject;

    var options = this._modifyDataObjectOptions(dataObject, _.extend({}, inheritVars[type].defaultOptions, options));
    this._objectOptionsByCid[dataObject.cid] = options;

    bindEvents.call(this, type, dataObject, this.constructor);
    bindEvents.call(this, type, dataObject, this);

    var spec = inheritVars[type];
    spec.bindCallback && spec.bindCallback.call(this, dataObject, options);

    if (dataObject.shouldFetch && dataObject.shouldFetch(options)) {
      loadObject(dataObject, options);
    } else if (inheritVars[type].change) {
      // want to trigger built in rendering without triggering event on model
      inheritVars[type].change.call(this, dataObject, options);
    }

    return true;
  },

  unbindDataObject: function (dataObject) {
    if (!this._boundDataObjectsByCid[dataObject.cid]) {
      return false;
    }
    delete this._boundDataObjectsByCid[dataObject.cid];
    this.stopListening(dataObject);
    delete this._objectOptionsByCid[dataObject.cid];
    return true;
  },

  _modifyDataObjectOptions: function(dataObject, options) {
    return options;
  }
});

function bindEvents(type, target, source) {
  var context = this;
  walkInheritTree(source, '_' + type + 'Events', true, function(event) {
    listenTo(context, target, event[0], event[1], event[2] || context);
  });
}

function loadObject(dataObject, options) {
  if (dataObject.load) {
    dataObject.load(function() {
      options && options.success && options.success(dataObject);
    }, options);
  } else {
    dataObject.fetch(options);
  }
}

function getEventCallback(callback, context) {
  if (_.isFunction(callback)) {
    return callback;
  } else {
    return context[callback];
  }
}

;;
/*global createRegistryWrapper, dataObject, getValue, inheritVars */
var modelCidAttributeName = 'data-model-cid';

Thorax.Model = Backbone.Model.extend({
  isEmpty: function() {
    return !this.isPopulated();
  },
  isPopulated: function() {
    // We are populated if we have attributes set
    var attributes = _.clone(this.attributes),
        defaults = getValue(this, 'defaults') || {};
    for (var default_key in defaults) {
      if (attributes[default_key] != defaults[default_key]) {
        return true;
      }
      delete attributes[default_key];
    }
    var keys = _.keys(attributes);
    return keys.length > 1 || (keys.length === 1 && keys[0] !== this.idAttribute);
  },
  shouldFetch: function(options) {
    // url() will throw if model has no `urlRoot` and no `collection`
    // or has `collection` and `collection` has no `url`
    var url;
    try {
      url = getValue(this, 'url');
    } catch(e) {
      url = false;
    }
    return options.fetch && !!url && !this.isPopulated();
  }
});

Thorax.Models = {};
createRegistryWrapper(Thorax.Model, Thorax.Models);

dataObject('model', {
  set: 'setModel',
  defaultOptions: {
    render: undefined,    // Default to deferred rendering
    fetch: true,
    success: false,
    invalid: true
  },
  change: onModelChange,
  $el: '$el',
  cidAttrName: modelCidAttributeName
});

function onModelChange(model, options) {
  if (options && options.serializing) {
    return;
  }

  var modelOptions = this.getObjectOptions(model) || {};
  // !modelOptions will be true when setModel(false) is called
  this.conditionalRender(modelOptions.render);
}

Thorax.View.on({
  model: {
    invalid: function(model, errors) {
      if (this.getObjectOptions(model).invalid) {
        this.trigger('invalid', errors, model);
      }
    },
    error: function(model, resp, options) {
      this.trigger('error', resp, model);
    },
    change: function(model, options) {
      // Indirect refernece to allow for overrides
      inheritVars.model.change.call(this, model, options);
    }
  }
});

$.fn.model = function(view) {
  var $this = $(this),
      modelElement = $this.closest('[' + modelCidAttributeName + ']'),
      modelCid = modelElement && modelElement.attr(modelCidAttributeName);
  if (modelCid) {
    var view = view || $this.view();
    if (view && view.model && view.model.cid === modelCid) {
      return view.model || false;
    }
    var collection = $this.collection(view);
    if (collection) {
      return collection.get(modelCid);
    }
  }
  return false;
};

;;
/*global assignView, assignTemplate, createRegistryWrapper, dataObject, getEventCallback, getValue, modelCidAttributeName, viewCidAttributeName */
var _fetch = Backbone.Collection.prototype.fetch,
    _set = Backbone.Collection.prototype.set,
    _replaceHTML = Thorax.View.prototype._replaceHTML,
    collectionCidAttributeName = 'data-collection-cid',
    collectionEmptyAttributeName = 'data-collection-empty',
    collectionElementAttributeName = 'data-collection-element',
    ELEMENT_NODE_TYPE = 1;

Thorax.Collection = Backbone.Collection.extend({
  model: Thorax.Model || Backbone.Model,
  initialize: function() {
    this.cid = _.uniqueId('collection');
    return Backbone.Collection.prototype.initialize.apply(this, arguments);
  },
  isEmpty: function() {
    if (this.length > 0) {
      return false;
    } else {
      return this.length === 0 && this.isPopulated();
    }
  },
  isPopulated: function() {
    return this._fetched || this.length > 0 || (!this.length && !getValue(this, 'url'));
  },
  shouldFetch: function(options) {
    return options.fetch && !!getValue(this, 'url') && !this.isPopulated();
  },
  fetch: function(options) {
    options = options || {};
    var success = options.success;
    options.success = function(collection, response) {
      collection._fetched = true;
      success && success(collection, response);
    };
    return _fetch.apply(this, arguments);
  },
  set: function(models, options) {
    this._fetched = !!models;
    return _set.call(this, models, options);
  }
});

_.extend(Thorax.View.prototype, {
  getCollectionViews: function(collection) {
    return _.filter(this.children, function(child) {
      if (!(child instanceof Thorax.CollectionView)) {
        return false;
      }

      return !collection || (child.collection === collection);
    });
  },
  updateFilter: function(collection) {
    _.invoke(this.getCollectionViews(collection), 'updateFilter');
  }
});

Thorax.Collections = {};
createRegistryWrapper(Thorax.Collection, Thorax.Collections);

dataObject('collection', {
  set: 'setCollection',
  bindCallback: onSetCollection,
  defaultOptions: {
    render: undefined,    // Default to deferred rendering
    fetch: true,
    success: false,
    invalid: true,
    change: true          // Wether or not to re-render on model:change
  },
  change: onCollectionReset,
  $el: 'getCollectionElement',
  cidAttrName: collectionCidAttributeName
});

Thorax.CollectionView = Thorax.View.extend({
  _defaultTemplate: Handlebars.VM.noop,
  _collectionSelector: '[' + collectionElementAttributeName + ']',

  // preserve collection element if it was not created with {{collection}} helper
  _replaceHTML: function(html) {
    if (this.collection && this.getObjectOptions(this.collection) && this._renderCount) {
      var element;
      var oldCollectionElement = this.getCollectionElement();
      element = _replaceHTML.call(this, html);
      if (!oldCollectionElement.attr('data-view-cid')) {
        this.getCollectionElement().replaceWith(oldCollectionElement);
      }
    } else {
      return _replaceHTML.call(this, html);
    }
  },

  render: function() {
    var shouldRender = this.shouldRender();

    Thorax.View.prototype.render.apply(this, arguments);
    if (!shouldRender) {
      this.renderCollection();
    }
  },

  //appendItem(model [,index])
  //appendItem(html_string, index)
  //appendItem(view, index)
  appendItem: function(model, index, options) {
    //empty item
    if (!model) {
      return;
    }
    var itemView,
        $el = this.getCollectionElement();
    options = _.defaults(options || {}, {
      filter: true
    });
    //if index argument is a view
    index && index.el && (index = $el.children().indexOf(index.el) + 1);
    //if argument is a view, or html string
    if (model.el || _.isString(model)) {
      itemView = model;
      model = false;
    } else {
      index = index || this.collection.indexOf(model) || 0;
      itemView = this.renderItem(model, index);
    }

    if (itemView) {
      if (itemView.cid) {
        itemView.ensureRendered();
        this._addChild(itemView);
      }

      //if the renderer's output wasn't contained in a tag, wrap it in a div
      //plain text, or a mixture of top level text nodes and element nodes
      //will get wrapped
      if (_.isString(itemView) && !itemView.match(/^\s*</m)) {
        itemView = '<div>' + itemView + '</div>';
      }
      var itemElement = itemView.$el || $($.trim(itemView)).filter(function() {
        //filter out top level whitespace nodes
        return this.nodeType === ELEMENT_NODE_TYPE;
      });

      if (model) {
        itemElement.attr(modelCidAttributeName, model.cid);
      }
      var previousModel = index > 0 ? this.collection.at(index - 1) : false;
      if (!previousModel) {
        $el.prepend(itemElement);
      } else {
        //use last() as appendItem can accept multiple nodes from a template
        var last = $el.children('[' + modelCidAttributeName + '="' + previousModel.cid + '"]').last();
        last.after(itemElement);
      }

      this.trigger('append', null, function(el) {
        el.setAttribute(modelCidAttributeName, model.cid);
      });

      if (!options.silent) {
        this.trigger('rendered:item', this, this.collection, model, itemElement, index);
      }
      if (options.filter) {
        applyItemVisiblityFilter.call(this, model);
      }
    }
    return itemView;
  },

  // updateItem only useful if there is no item view, otherwise
  // itemView.render() provides the same functionality
  updateItem: function(model) {
    var $el = this.getCollectionElement(),
        viewEl = $el.find('[' + modelCidAttributeName + '="' + model.cid + '"]');

    // NOP For views
    if (viewEl.attr(viewCidAttributeName)) {
      return;
    }

    this.removeItem(viewEl);
    this.appendItem(model);
  },

  removeItem: function(model) {
    var viewEl = model;
    if (model.cid) {
      var $el = this.getCollectionElement();
      viewEl = $el.find('[' + modelCidAttributeName + '="' + model.cid + '"]');
    }
    if (!viewEl.length) {
      return false;
    }
    viewEl.remove();
    var viewCid = viewEl.attr(viewCidAttributeName),
        child = this.children[viewCid];
    if (child) {
      this._removeChild(child);
    }
    return true;
  },

  renderCollection: function() {
    if (this.collection) {
      if (this.collection.isEmpty()) {
        handleChangeFromNotEmptyToEmpty.call(this);
      } else {
        handleChangeFromEmptyToNotEmpty.call(this);
        this.collection.forEach(function(item, i) {
          this.appendItem(item, i);
        }, this);
      }
      this.trigger('rendered:collection', this, this.collection);
    } else {
      handleChangeFromNotEmptyToEmpty.call(this);
    }
  },
  emptyClass: 'empty',
  renderEmpty: function() {
    if (!this.emptyView) {
      assignView.call(this, 'emptyView', {
        extension: '-empty'
      });
    }
    if (!this.emptyTemplate && !this.emptyView) {
      assignTemplate.call(this, 'emptyTemplate', {
        extension: '-empty',
        required: false
      });
    }
    if (this.emptyView) {
      var viewOptions = {};
      if (this.emptyTemplate) {
        viewOptions.template = this.emptyTemplate;
      }
      var view = Thorax.Util.getViewInstance(this.emptyView, viewOptions);
      view.ensureRendered();
      return view;
    } else {
      return this.emptyTemplate && this.renderTemplate(this.emptyTemplate);
    }
  },
  renderItem: function(model, i) {
    if (!this.itemView) {
      assignView.call(this, 'itemView', {
        extension: '-item',
        required: false
      });
    }
    if (!this.itemTemplate && !this.itemView) {
      assignTemplate.call(this, 'itemTemplate', {
        extension: '-item',
        // only require an itemTemplate if an itemView
        // is not present
        required: !this.itemView
      });
    }
    if (this.itemView) {
      var viewOptions = {
        model: model
      };
      if (this.itemTemplate) {
        viewOptions.template = this.itemTemplate;
      }
      return Thorax.Util.getViewInstance(this.itemView, viewOptions);
    } else {
      return this.renderTemplate(this.itemTemplate, this.itemContext(model, i));
    }
  },
  itemContext: function(model /*, i */) {
    return model.attributes;
  },
  appendEmpty: function() {
    var $el = this.getCollectionElement();
    $el.empty();
    var emptyContent = this.renderEmpty();
    emptyContent && this.appendItem(emptyContent, 0, {
      silent: true,
      filter: false
    });
    this.trigger('rendered:empty', this, this.collection);
  },
  getCollectionElement: function() {
    var element = this.$(this._collectionSelector);
    return element.length === 0 ? this.$el : element;
  },

  updateFilter: function() {
    applyVisibilityFilter.call(this);
  }
});

Thorax.CollectionView.on({
  collection: {
    reset: onCollectionReset,
    sort: onCollectionReset,
    change: function(model) {
      var options = this.getObjectOptions(this.collection);
      if (options && options.change) {
        this.updateItem(model);
      }
      applyItemVisiblityFilter.call(this, model);
    },
    add: function(model) {
      var $el = this.getCollectionElement();
      this.collection.length === 1 && $el.length && handleChangeFromEmptyToNotEmpty.call(this);
      if ($el.length) {
        var index = this.collection.indexOf(model);
        this.appendItem(model, index);
      }
    },
    remove: function(model) {
      var $el = this.getCollectionElement();
      this.removeItem(model);
      this.collection.length === 0 && $el.length && handleChangeFromNotEmptyToEmpty.call(this);
    }
  }
});

Thorax.View.on({
  collection: {
    invalid: function(collection, message) {
      if (this.getObjectOptions(collection).invalid) {
        this.trigger('invalid', message, collection);
      }
    },
    error: function(collection, resp, options) {
      this.trigger('error', resp, collection);
    }
  }
});

function onCollectionReset(collection) {
  // Undefined to force conditional render
  var options = this.getObjectOptions(collection) || undefined;
  if (this.shouldRender(options && options.render)) {
    this.renderCollection && this.renderCollection();
  }
}

// Even if the view is not a CollectionView
// ensureRendered() to provide similar behavior
// to a model
function onSetCollection(collection) {
  // Undefined to force conditional render
  var options = this.getObjectOptions(collection) || undefined;
  if (this.shouldRender(options && options.render)) {
    // Ensure that something is there if we are going to render the collection.
    this.ensureRendered();
  }
}

function applyVisibilityFilter() {
  if (this.itemFilter) {
    this.collection.forEach(applyItemVisiblityFilter, this);
  }
}

function applyItemVisiblityFilter(model) {
  var $el = this.getCollectionElement();
  this.itemFilter && $el.find('[' + modelCidAttributeName + '="' + model.cid + '"]')[itemShouldBeVisible.call(this, model) ? 'show' : 'hide']();
}

function itemShouldBeVisible(model) {
  return this.itemFilter(model, this.collection.indexOf(model));
}

function handleChangeFromEmptyToNotEmpty() {
  var $el = this.getCollectionElement();
  this.emptyClass && $el.removeClass(this.emptyClass);
  $el.removeAttr(collectionEmptyAttributeName);
  $el.empty();
}

function handleChangeFromNotEmptyToEmpty() {
  var $el = this.getCollectionElement();
  this.emptyClass && $el.addClass(this.emptyClass);
  $el.attr(collectionEmptyAttributeName, true);
  this.appendEmpty();
}

//$(selector).collection() helper
$.fn.collection = function(view) {
  if (view && view.collection) {
    return view.collection;
  }
  var $this = $(this),
      collectionElement = $this.closest('[' + collectionCidAttributeName + ']'),
      collectionCid = collectionElement && collectionElement.attr(collectionCidAttributeName);
  if (collectionCid) {
    view = $this.view();
    if (view) {
      return view.collection;
    }
  }
  return false;
};

;;
/*global inheritVars */

inheritVars.model.defaultOptions.populate = true;

var oldModelChange = inheritVars.model.change;
inheritVars.model.change = function(model, options) {
  this._isChanging = true;
  oldModelChange.apply(this, arguments);
  this._isChanging = false;

  if (options && options.serializing) {
    return;
  }

  var populate = populateOptions(this);
  if (this._renderCount && populate) {
    this.populate(!populate.context && this.model.attributes, populate);
  }
};

_.extend(Thorax.View.prototype, {
  //serializes a form present in the view, returning the serialized data
  //as an object
  //pass {set:false} to not update this.model if present
  //can pass options, callback or event in any order
  serialize: function() {
    var callback, options, event;
    //ignore undefined arguments in case event was null
    for (var i = 0; i < arguments.length; ++i) {
      if (_.isFunction(arguments[i])) {
        callback = arguments[i];
      } else if (_.isObject(arguments[i])) {
        if ('stopPropagation' in arguments[i] && 'preventDefault' in arguments[i]) {
          event = arguments[i];
        } else {
          options = arguments[i];
        }
      }
    }

    if (event && !this._preventDuplicateSubmission(event)) {
      return;
    }

    options = _.extend({
      set: true,
      validate: true,
      children: true
    }, options || {});

    var attributes = options.attributes || {};

    //callback has context of element
    var view = this;
    var errors = [];
    eachNamedInput(this, options, function(element) {
      var value = view._getInputValue(element, options, errors);
      if (!_.isUndefined(value)) {
        objectAndKeyFromAttributesAndName(attributes, element.name, {mode: 'serialize'}, function(object, key) {
          if (!object[key]) {
            object[key] = value;
          } else if (_.isArray(object[key])) {
            object[key].push(value);
          } else {
            object[key] = [object[key], value];
          }
        });
      }
    });

    if (!options._silent) {
      this.trigger('serialize', attributes, options);
    }

    if (options.validate) {
      var validateInputErrors = this.validateInput(attributes);
      if (validateInputErrors && validateInputErrors.length) {
        errors = errors.concat(validateInputErrors);
      }
      this.trigger('validate', attributes, errors, options);
      if (errors.length) {
        this.trigger('invalid', errors);
        return;
      }
    }

    if (options.set && this.model) {
      if (!this.model.set(attributes, {silent: options.silent, serializing: true})) {
        return false;
      }
    }

    callback && callback.call(this, attributes, _.bind(resetSubmitState, this));
    return attributes;
  },

  _preventDuplicateSubmission: function(event, callback) {
    event.preventDefault();

    var form = $(event.target);
    if ((event.target.tagName || '').toLowerCase() !== 'form') {
      // Handle non-submit events by gating on the form
      form = $(event.target).closest('form');
    }

    if (!form.attr('data-submit-wait')) {
      form.attr('data-submit-wait', 'true');
      if (callback) {
        callback.call(this, event);
      }
      return true;
    } else {
      return false;
    }
  },

  //populate a form from the passed attributes or this.model if present
  populate: function(attributes, options) {
    options = _.extend({
      children: true
    }, options || {});

    var value,
        attributes = attributes || this._getContext();

    //callback has context of element
    eachNamedInput(this, options, function(element) {
      objectAndKeyFromAttributesAndName(attributes, element.name, {mode: 'populate'}, function(object, key) {
        value = object && object[key];

        if (!_.isUndefined(value)) {
          //will only execute if we have a name that matches the structure in attributes
          var isBinary = element.type === 'checkbox' || element.type === 'radio';
          if (isBinary && _.isBoolean(value)) {
            element.checked = value;
          } else if (isBinary) {
            element.checked = value == element.value;
          } else {
            element.value = value;
          }
        }
      });
    });

    ++this._populateCount;
    if (!options._silent) {
      this.trigger('populate', attributes);
    }
  },

  //perform form validation, implemented by child class
  validateInput: function(/* attributes, options, errors */) {},

  _getInputValue: function(input /* , options, errors */) {
    if (input.type === 'checkbox' || input.type === 'radio') {
      if (input.checked) {
        return input.getAttribute('value') || true;
      }
    } else if (input.multiple === true) {
      var values = [];
      $('option', input).each(function() {
        if (this.selected) {
          values.push(this.value);
        }
      });
      return values;
    } else {
      return input.value;
    }
  },

  _populateCount: 0
});

// Keeping state in the views
Thorax.View.on({
  'before:rendered': function() {
    // Do not store previous options if we have not rendered or if we have changed the associated
    // model since the last render
    if (!this._renderCount || (this.model && this.model.cid) !== this._formModelCid) {
      return;
    }

    var modelOptions = this.getObjectOptions(this.model);
    // When we have previously populated and rendered the view, reuse the user data
    this.previousFormData = filterObject(
      this.serialize(_.extend({ set: false, validate: false, _silent: true }, modelOptions)),
      function(value) { return value !== '' && value != null; }
    );
  },
  rendered: function() {
    var populate = populateOptions(this);

    if (populate && !this._isChanging && !this._populateCount) {
      this.populate(!populate.context && this.model.attributes, populate);
    }
    if (this.previousFormData) {
      this.populate(this.previousFormData, _.extend({_silent: true}, populate));
    }

    this._formModelCid = this.model && this.model.cid;
    this.previousFormData = null;
  }
});

function filterObject(object, callback) {
  _.each(object, function (value, key) {
    if (_.isObject(value)) {
      return filterObject(value, callback);
    }
    if (callback(value, key, object) === false) {
      delete object[key];
    }
  });
  return object;
}

Thorax.View.on({
  invalid: onErrorOrInvalidData,
  error: onErrorOrInvalidData,
  deactivated: function() {
    if (this.$el) {
      resetSubmitState.call(this);
    }
  }
});

function onErrorOrInvalidData () {
  resetSubmitState.call(this);

  // If we errored with a model we want to reset the content but leave the UI
  // intact. If the user updates the data and serializes any overwritten data
  // will be restored.
  if (this.model && this.model.previousAttributes) {
    this.model.set(this.model.previousAttributes(), {
      silent: true
    });
  }
}

function eachNamedInput(view, options, iterator) {
  var i = 0;

  $('select,input,textarea', options.root || view.el).each(function() {
    if (!options.children) {
      if (view !== $(this).view({helper: false})) {
        return;
      }
    }
    if (this.type !== 'button' && this.type !== 'cancel' && this.type !== 'submit' && this.name) {
      iterator(this, i);
      ++i;
    }
  });
}

//calls a callback with the correct object fragment and key from a compound name
function objectAndKeyFromAttributesAndName(attributes, name, options, callback) {
  var key,
      object = attributes,
      keys = name.split('['),
      mode = options.mode;

  for (var i = 0; i < keys.length - 1; ++i) {
    key = keys[i].replace(']', '');
    if (!object[key]) {
      if (mode === 'serialize') {
        object[key] = {};
      } else {
        return callback(undefined, key);
      }
    }
    object = object[key];
  }
  key = keys[keys.length - 1].replace(']', '');
  callback(object, key);
}

function resetSubmitState() {
  this.$('form').removeAttr('data-submit-wait');
}

function populateOptions(view) {
  var modelOptions = view.getObjectOptions(view.model) || {};
  return modelOptions.populate === true ? {} : modelOptions.populate;
}

;;
/*global getOptionsData, normalizeHTMLAttributeOptions, createErrorMessage */
var layoutCidAttributeName = 'data-layout-cid';

Thorax.LayoutView = Thorax.View.extend({
  _defaultTemplate: Handlebars.VM.noop,
  render: function() {
    var response = Thorax.View.prototype.render.apply(this, arguments);
    if (this.template === Handlebars.VM.noop) {
      // if there is no template setView will append to this.$el
      ensureLayoutCid.call(this);
    } else {
      // if a template was specified is must declare a layout-element
      ensureLayoutViewsTargetElement.call(this);
    }
    return response;
  },
  setView: function(view, options) {
    options = _.extend({
      scroll: true
    }, options || {});
    if (_.isString(view)) {
      view = new (Thorax.Util.registryGet(Thorax, 'Views', view, false))();
    }
    this.ensureRendered();
    var oldView = this._view, append, remove, complete;
    if (view === oldView) {
      return false;
    }
    this.trigger('change:view:start', view, oldView, options);

    remove = _.bind(function() {
      if (oldView) {
        oldView.$el && oldView.$el.remove();
        triggerLifecycleEvent.call(oldView, 'deactivated', options);
        this._removeChild(oldView);
      }
    }, this);

    append = _.bind(function() {
      if (view) {
        view.ensureRendered();
        triggerLifecycleEvent.call(this, 'activated', options);
        view.trigger('activated', options);
        this._view = view;
        var targetElement = getLayoutViewsTargetElement.call(this);
        this._view.appendTo(targetElement);
        this._addChild(view);
      } else {
        this._view = undefined;
      }
    }, this);

    complete = _.bind(function() {
      this.trigger('change:view:end', view, oldView, options);
    }, this);

    if (!options.transition) {
      remove();
      append();
      complete();
    } else {
      options.transition(view, oldView, append, remove, complete);
    }

    return view;
  },

  getView: function() {
    return this._view;
  }
});

Handlebars.registerHelper('layout-element', function(options) {
  var view = getOptionsData(options).view;
  // duck type check for LayoutView
  if (!view.getView) {
    throw new Error(createErrorMessage('layout-element-helper'));
  }
  options.hash[layoutCidAttributeName] = view.cid;
  normalizeHTMLAttributeOptions(options.hash);
  return new Handlebars.SafeString(Thorax.Util.tag.call(this, options.hash, '', this));
});

function triggerLifecycleEvent(eventName, options) {
  options = options || {};
  options.target = this;
  this.trigger(eventName, options);
  _.each(this.children, function(child) {
    child.trigger(eventName, options);
  });
}

function ensureLayoutCid() {
  ++this._renderCount;
  //set the layoutCidAttributeName on this.$el if there was no template
  this.$el.attr(layoutCidAttributeName, this.cid);
}

function ensureLayoutViewsTargetElement() {
  if (!this.$('[' + layoutCidAttributeName + '="' + this.cid + '"]')[0]) {
    throw new Error('No layout element found in ' + (this.name || this.cid));
  }
}

function getLayoutViewsTargetElement() {
  return this.$('[' + layoutCidAttributeName + '="' + this.cid + '"]')[0] || this.el[0] || this.el;
}

;;
/* global createErrorMessage */

Thorax.CollectionHelperView = Thorax.CollectionView.extend({
  // Forward render events to the parent
  events: {
    'rendered:item': forwardRenderEvent('rendered:item'),
    'rendered:collection': forwardRenderEvent('rendered:collection'),
    'rendered:empty': forwardRenderEvent('rendered:empty')
  },

  // Thorax.CollectionView allows a collectionSelector
  // to be specified, disallow in a collection helper
  // as it will cause problems when neseted
  getCollectionElement: function() {
    return this.$el;
  },

  constructor: function(options) {
    // need to fetch templates if template name was passed
    if (options.options['item-template']) {
      options.itemTemplate = Thorax.Util.getTemplate(options.options['item-template']);
    }
    if (options.options['empty-template']) {
      options.emptyTemplate = Thorax.Util.getTemplate(options.options['empty-template']);
    }

    // Handlebars.VM.noop is passed in the handlebars options object as
    // a default for fn and inverse, if a block was present. Need to
    // check to ensure we don't pick the empty / null block up.
    if (!options.itemTemplate && options.template && options.template !== Handlebars.VM.noop) {
      options.itemTemplate = options.template;
      options.template = Handlebars.VM.noop;
    }
    if (!options.emptyTemplate && options.inverse && options.inverse !== Handlebars.VM.noop) {
      options.emptyTemplate = options.inverse;
      options.inverse = Handlebars.VM.noop;
    }

    var shouldBindItemContext = _.isFunction(options.itemContext),
        shouldBindItemFilter = _.isFunction(options.itemFilter);

    var response = Thorax.HelperView.call(this, options);
    
    if (shouldBindItemContext) {
      this.itemContext = _.bind(this.itemContext, this.parent);
    } else if (_.isString(this.itemContext)) {
      this.itemContext = _.bind(this.parent[this.itemContext], this.parent);
    }

    if (shouldBindItemFilter) {
      this.itemFilter = _.bind(this.itemFilter, this.parent);
    } else if (_.isString(this.itemFilter)) {
      this.itemFilter = _.bind(this.parent[this.itemFilter], this.parent);
    }

    if (this.parent.name) {
      if (!this.emptyView && !this.parent.renderEmpty) {
        this.emptyView = Thorax.Util.getViewClass(this.parent.name + '-empty', true);
      }
      if (!this.emptyTemplate && !this.parent.renderEmpty) {
        this.emptyTemplate = Thorax.Util.getTemplate(this.parent.name + '-empty', true);
      }
      if (!this.itemView && !this.parent.renderItem) {
        this.itemView = Thorax.Util.getViewClass(this.parent.name + '-item', true);
      }
      if (!this.itemTemplate && !this.parent.renderItem) {
        // item template must be present if an itemView is not
        this.itemTemplate = Thorax.Util.getTemplate(this.parent.name + '-item', !!this.itemView);
      }
    }

    return response;
  },
  setAsPrimaryCollectionHelper: function() {
    _.each(forwardableProperties, function(propertyName) {
      forwardMissingProperty.call(this, propertyName);
    }, this);

    var self = this;
    _.each(['itemFilter', 'itemContext', 'renderItem', 'renderEmpty'], function(propertyName) {
      if (self.parent[propertyName]) {
        self[propertyName] = function() {
          return self.parent[propertyName].apply(self.parent, arguments);
        };
      }
    });
  }
});

_.extend(Thorax.CollectionHelperView.prototype, helperViewPrototype);


Thorax.CollectionHelperView.attributeWhiteList = {
  'item-context': 'itemContext',
  'item-filter': 'itemFilter',
  'item-template': 'itemTemplate',
  'empty-template': 'emptyTemplate',
  'item-view': 'itemView',
  'empty-view': 'emptyView',
  'empty-class': 'emptyClass'
};

function forwardRenderEvent(eventName) {
  return function() {
    var args = _.toArray(arguments);
    args.unshift(eventName);
    this.parent.trigger.apply(this.parent, args);
  };
}

var forwardableProperties = [
  'itemTemplate',
  'itemView',
  'emptyTemplate',
  'emptyView'
];

function forwardMissingProperty(propertyName) {
  var parent = getParent(this);
  if (!this[propertyName]) {
    var prop = parent[propertyName];
    if (prop){
      this[propertyName] = prop;
    }
  }
}

Handlebars.registerViewHelper('collection', Thorax.CollectionHelperView, function(collection, view) {
  if (arguments.length === 1) {
    view = collection;
    collection = view.parent.collection;
    collection && view.setAsPrimaryCollectionHelper();
    view.$el.attr(collectionElementAttributeName, 'true');
    // propagate future changes to the parent's collection object
    // to the helper view
    view.listenTo(view.parent, 'change:data-object', function(type, dataObject) {
      if (type === 'collection') {
        view.setAsPrimaryCollectionHelper();
        view.setCollection(dataObject);
      }
    });
  }
  collection && view.setCollection(collection);
});

Handlebars.registerHelper('collection-element', function(options) {
  if (!getOptionsData(options).view.renderCollection) {
    throw new Error(createErrorMessage('collection-element-helper'));
  }
  var hash = options.hash;
  normalizeHTMLAttributeOptions(hash);
  hash.tagName = hash.tagName || 'div';
  hash[collectionElementAttributeName] = true;
  return new Handlebars.SafeString(Thorax.Util.tag.call(this, hash, '', this));
});

;;
Handlebars.registerHelper('empty', function(dataObject, options) {
  if (arguments.length === 1) {
    options = dataObject;
  }
  var view = getOptionsData(options).view;
  if (arguments.length === 1) {
    dataObject = view.model;
  }
  // listeners for the empty helper rather than listeners
  // that are themselves empty
  if (!view._emptyListeners) {
    view._emptyListeners = {};
  }
  // duck type check for collection
  if (dataObject && !view._emptyListeners[dataObject.cid] && dataObject.models && ('length' in dataObject)) {
    view._emptyListeners[dataObject.cid] = true;
    view.listenTo(dataObject, 'remove', function() {
      if (dataObject.length === 0) {
        view.render();
      }
    });
    view.listenTo(dataObject, 'add', function() {
      if (dataObject.length === 1) {
        view.render();
      }
    });
    view.listenTo(dataObject, 'reset', function() {
      view.render();
    });
  }
  return !dataObject || dataObject.isEmpty() ? options.fn(this) : options.inverse(this);
});

;;
Handlebars.registerHelper('template', function(name, options) {
  var context = _.extend({fn: options && options.fn}, this, options ? options.hash : {});
  var output = getOptionsData(options).view.renderTemplate(name, context);
  return new Handlebars.SafeString(output);
});

Handlebars.registerHelper('yield', function(options) {
  return getOptionsData(options).yield && options.data.yield();
});

;;
Handlebars.registerHelper('url', function(url) {
  var fragment;
  if (arguments.length > 2) {
    fragment = _.map(_.head(arguments, arguments.length - 1), encodeURIComponent).join('/');
  } else {
    var options = arguments[1],
        hash = (options && options.hash) || options;
    if (hash && hash['expand-tokens']) {
      fragment = Thorax.Util.expandToken(url, this);
    } else {
      fragment = url;
    }
  }
  if (Backbone.history._hasPushState) {
    var root = Backbone.history.options.root;
    if (root === '/' && fragment.substr(0, 1) === '/') {
      return fragment;
    } else {
      return root + fragment;
    }
  } else {
    return '#' + fragment;
  }
});

;;
/*global viewTemplateOverrides, createErrorMessage */
Handlebars.registerViewHelper('view', {
  factory: function(args, options) {
    var View = args.length >= 1 ? args[0] : Thorax.View;
    return Thorax.Util.getViewInstance(View, options.options);
  },
  // ensure generated placeholder tag in template
  // will match tag of view instance
  modifyHTMLAttributes: function(htmlAttributes, instance) {
    htmlAttributes.tagName = instance.el.tagName.toLowerCase();
  },
  callback: function(view) {
    var instance = arguments[arguments.length-1],
        options = instance._helperOptions.options,
        placeholderId = instance.cid;
    // view will be the argument passed to the helper, if it was
    // a string, a new instance was created on the fly, ok to pass
    // hash arguments, otherwise need to throw as templates should
    // not introduce side effects to existing view instances
    if (!_.isString(view) && options.hash && _.keys(options.hash).length > 0) {
      throw new Error(createErrorMessage('view-helper-hash-args'));
    }
    if (options.fn) {
      viewTemplateOverrides[placeholderId] = options.fn;
    }
  }
});

;;
/* global createErrorMessage */

var callMethodAttributeName = 'data-call-method',
    triggerEventAttributeName = 'data-trigger-event';

Handlebars.registerHelper('button', function(method, options) {
  if (arguments.length === 1) {
    options = method;
    method = options.hash.method;
  }
  var hash = options.hash,
      expandTokens = hash['expand-tokens'];
  delete hash['expand-tokens'];
  if (!method && !options.hash.trigger) {
    throw new Error(createErrorMessage('button-trigger'));
  }
  normalizeHTMLAttributeOptions(hash);
  hash.tagName = hash.tagName || 'button';
  hash.trigger && (hash[triggerEventAttributeName] = hash.trigger);
  delete hash.trigger;
  method && (hash[callMethodAttributeName] = method);
  return new Handlebars.SafeString(Thorax.Util.tag(hash, options.fn ? options.fn(this) : '', expandTokens ? this : null));
});

Handlebars.registerHelper('link', function() {
  var args = _.toArray(arguments),
      options = args.pop(),
      hash = options.hash,
      // url is an array that will be passed to the url helper
      url = args.length === 0 ? [hash.href] : args,
      expandTokens = hash['expand-tokens'];
  delete hash['expand-tokens'];
  if (!url[0] && url[0] !== '') {
    throw new Error(createErrorMessage('link-href'));
  }
  normalizeHTMLAttributeOptions(hash);
  url.push(options);
  hash.href = Handlebars.helpers.url.apply(this, url);
  hash.tagName = hash.tagName || 'a';
  hash.trigger && (hash[triggerEventAttributeName] = options.hash.trigger);
  delete hash.trigger;
  hash[callMethodAttributeName] = '_anchorClick';
  return new Handlebars.SafeString(Thorax.Util.tag(hash, options.fn ? options.fn(this) : '', expandTokens ? this : null));
});

var clickSelector = '[' + callMethodAttributeName + '], [' + triggerEventAttributeName + ']';

function handleClick(event) {
  var $this = $(this),
      view = $this.view({helper: false}),
      methodName = $this.attr(callMethodAttributeName),
      eventName = $this.attr(triggerEventAttributeName),
      methodResponse = false;
  methodName && (methodResponse = view[methodName].call(view, event));
  eventName && view.trigger(eventName, event);
  this.tagName === 'A' && methodResponse === false && event.preventDefault();
}

var lastClickHandlerEventName;

function registerClickHandler() {
  unregisterClickHandler();
  lastClickHandlerEventName = Thorax._fastClickEventName || 'click';
  $(document).on(lastClickHandlerEventName, clickSelector, handleClick);
}

function unregisterClickHandler() {
  lastClickHandlerEventName && $(document).off(lastClickHandlerEventName, clickSelector, handleClick);
}

$(document).ready(function() {
  if (!Thorax._fastClickEventName) {
    registerClickHandler();
  }
});

;;
var elementPlaceholderAttributeName = 'data-element-tmp';

Handlebars.registerHelper('element', function(element, options) {
  normalizeHTMLAttributeOptions(options.hash);
  var cid = _.uniqueId('element'),
      declaringView = getOptionsData(options).view;
  options.hash[elementPlaceholderAttributeName] = cid;
  declaringView._elementsByCid || (declaringView._elementsByCid = {});
  declaringView._elementsByCid[cid] = element;
  return new Handlebars.SafeString(Thorax.Util.tag(options.hash));
});

Thorax.View.on('append', function(scope, callback) {
  (scope || this.$el).find('[' + elementPlaceholderAttributeName + ']').forEach(function(el) {
    var $el = $(el),
        cid = $el.attr(elementPlaceholderAttributeName),
        element = this._elementsByCid[cid];
    // A callback function may be specified as the value
    if (_.isFunction(element)) {
      element = element.call(this);
    }
    $el.replaceWith(element);
    callback && callback(element);
  }, this);
});

;;
/* global createErrorMessage */

Handlebars.registerHelper('super', function(options) {
  var declaringView = getOptionsData(options).view,
      parent = declaringView.constructor && declaringView.constructor.__super__;
  if (parent) {
    var template = parent.template;
    if (!template) {
      if (!parent.name) {
        throw new Error(createErrorMessage('super-parent'));
      }
      template = parent.name;
    }
    if (_.isString(template)) {
      template = Thorax.Util.getTemplate(template, false);
    }
    return new Handlebars.SafeString(template(this, options));
  } else {
    return '';
  }
});

;;
/*global collectionOptionNames, inheritVars, createErrorMessage */

var loadStart = 'load:start',
    loadEnd = 'load:end',
    rootObject;

Thorax.setRootObject = function(obj) {
  rootObject = obj;
};

Thorax.loadHandler = function(start, end, context) {
  var loadCounter = _.uniqueId('load');
  return function(message, background, object) {
    var self = context || this;
    self._loadInfo = self._loadInfo || {};
    var loadInfo = self._loadInfo[loadCounter];

    function startLoadTimeout() {

      // If the timeout has been set already but has not triggered yet do nothing
      // Otherwise set a new timeout (either initial or for going from background to
      // non-background loading)
      if (loadInfo.timeout && !loadInfo.run) {
        return;
      }

      var loadingTimeout = self._loadingTimeoutDuration !== undefined ?
        self._loadingTimeoutDuration : Thorax.View.prototype._loadingTimeoutDuration;
      loadInfo.timeout = setTimeout(function() {
          try {
            // We have a slight race condtion in here where the end event may have occurred
            // but the end timeout has not executed. Rather than killing a cumulative timeout
            // immediately we'll protect from that case here
            if (loadInfo.events.length) {
              loadInfo.run = true;
              start.call(self, loadInfo.message, loadInfo.background, loadInfo);
            }
          } catch (e) {
            Thorax.onException('loadStart', e);
          }
        }, loadingTimeout * 1000);
    }

    if (!loadInfo) {
      loadInfo = self._loadInfo[loadCounter] = _.extend({
        isLoading: function() {
          return loadInfo.events.length;
        },

        cid: loadCounter,
        events: [],
        timeout: 0,
        message: message,
        background: !!background
      }, Backbone.Events);
      startLoadTimeout();
    } else {
      clearTimeout(loadInfo.endTimeout);

      loadInfo.message = message;
      if (!background && loadInfo.background) {
        loadInfo.background = false;
        startLoadTimeout();
      }
    }

    // Prevent binds to the same object multiple times as this can cause very bad things
    // to happen for the load;load;end;end execution flow.
    if (_.indexOf(loadInfo.events, object) >= 0) {
      return;
    }

    loadInfo.events.push(object);

    object.on(loadEnd, function endCallback() {
      var loadingEndTimeout = self._loadingTimeoutEndDuration;
      if (loadingEndTimeout === void 0) {
        // If we are running on a non-view object pull the default timeout
        loadingEndTimeout = Thorax.View.prototype._loadingTimeoutEndDuration;
      }

      var events = loadInfo.events,
          index = _.indexOf(events, object);
      if (index >= 0 && !object.isLoading()) {
        events.splice(index, 1);

        if (_.indexOf(events, object) < 0) {
          // Last callback for this particlar object, remove the bind
          object.off(loadEnd, endCallback);
        }
      }

      if (!events.length) {
        clearTimeout(loadInfo.endTimeout);
        loadInfo.endTimeout = setTimeout(function() {
          try {
            if (!events.length) {
              if (loadInfo.run) {
                // Emit the end behavior, but only if there is a paired start
                end && end.call(self, loadInfo.background, loadInfo);
                loadInfo.trigger(loadEnd, loadInfo);
              }

              // If stopping make sure we don't run a start
              clearTimeout(loadInfo.timeout);
              loadInfo = self._loadInfo[loadCounter] = undefined;
            }
          } catch (e) {
            Thorax.onException('loadEnd', e);
          }
        }, loadingEndTimeout * 1000);
      }
    });
  };
};

/**
 * Helper method for propagating load:start events to other objects.
 *
 * Forwards load:start events that occur on `source` to `dest`.
 */
Thorax.forwardLoadEvents = function(source, dest, once) {
  function load(message, backgound, object) {
    if (once) {
      source.off(loadStart, load);
    }
    dest.trigger(loadStart, message, backgound, object);
  }
  source.on(loadStart, load);
  return {
    off: function() {
      source.off(loadStart, load);
    }
  };
};

//
// Data load event generation
//

/**
 * Mixing for generating load:start and load:end events.
 */
Thorax.mixinLoadable = function(target, useParent) {
  _.extend(target, {
    //loading config
    _loadingClassName: 'loading',
    _loadingTimeoutDuration: 0.33,
    _loadingTimeoutEndDuration: 0.10,

    // Propagates loading view parameters to the AJAX layer
    onLoadStart: function(message, background, object) {
      var that = useParent ? this.parent : this;

      // Protect against race conditions
      if (!that || !that.el) {
        return;
      }

      if (!that.nonBlockingLoad && !background && rootObject && rootObject !== this) {
        rootObject.trigger(loadStart, message, background, object);
      }
      that._isLoading = true;
      $(that.el).addClass(that._loadingClassName);
      // used by loading helpers
      that.trigger('change:load-state', 'start', background);
    },
    onLoadEnd: function(/* background, object */) {
      var that = useParent ? this.parent : this;

      // Protect against race conditions
      if (!that || !that.el) {
        return;
      }

      that._isLoading = false;
      $(that.el).removeClass(that._loadingClassName);
      // used by loading helper
      that.trigger('change:load-state', 'end');
    }
  });
};

Thorax.mixinLoadableEvents = function(target, useParent) {
  _.extend(target, {
    _loadCount: 0,

    isLoading: function() {
      return this._loadCount > 0;
    },

    loadStart: function(message, background) {
      this._loadCount++;

      var that = useParent ? this.parent : this;
      that.trigger(loadStart, message, background, that);
    },
    loadEnd: function() {
      this._loadCount--;

      var that = useParent ? this.parent : this;
      that.trigger(loadEnd, that);
    }
  });
};

Thorax.mixinLoadable(Thorax.View.prototype);
Thorax.mixinLoadableEvents(Thorax.View.prototype);


if (Thorax.HelperView) {
  Thorax.mixinLoadable(Thorax.HelperView.prototype, true);
  Thorax.mixinLoadableEvents(Thorax.HelperView.prototype, true);
}

if (Thorax.CollectionHelperView) {
  Thorax.mixinLoadable(Thorax.CollectionHelperView.prototype, true);
  Thorax.mixinLoadableEvents(Thorax.CollectionHelperView.prototype, true);
}

Thorax.sync = function(method, dataObj, options) {
  var self = this,
      complete = options.complete;

  options.complete = function() {
    self._request = undefined;
    self._aborted = false;

    complete && complete.apply(this, arguments);
  };
  this._request = Backbone.sync.apply(this, arguments);

  return this._request;
};

function bindToRoute(callback, failback) {
  var fragment = Backbone.history.getFragment(),
      routeChanged = false;

  function routeHandler() {
    if (fragment === Backbone.history.getFragment()) {
      return;
    }
    routeChanged = true;
    res.cancel();
    failback && failback();
  }

  Backbone.history.on('route', routeHandler);

  function finalizer() {
    Backbone.history.off('route', routeHandler);
    if (!routeChanged) {
      callback.apply(this, arguments);
    }
  }

  var res = _.bind(finalizer, this);
  res.cancel = function() {
    Backbone.history.off('route', routeHandler);
  };

  return res;
}

function loadData(callback, failback, options) {
  if (this.isPopulated()) {
    // Defer here to maintain async callback behavior for all loading cases
    return _.defer(callback, this);
  }

  if (arguments.length === 2 && !_.isFunction(failback) && _.isObject(failback)) {
    options = failback;
    failback = false;
  }

  var self = this,
      routeChanged = false,
      successCallback = bindToRoute(_.bind(callback, self), function() {
        routeChanged = true;
        if (self._request) {
          self._aborted = true;
          self._request.abort();
        }
        failback && failback.call(self, false);
      });

  this.fetch(_.defaults({
    success: successCallback,
    error: function() {
      successCallback.cancel();
      if (!routeChanged && failback) {
        failback.apply(self, [true].concat(_.toArray(arguments)));
      }
    }
  }, options));
}

function fetchQueue(options, $super) {
  if (options.resetQueue) {
    // WARN: Should ensure that loaders are protected from out of band data
    //    when using this option
    this.fetchQueue = undefined;
  } else if (this.fetchQueue) {
    // concurrent set/reset fetch events are not advised
    var reset = (this.fetchQueue[0] || {}).reset;
    if (reset !== options.reset) {
      // fetch with concurrent set & reset not allowed
      throw new Error(createErrorMessage('mixed-fetch'));
    }
  }

  if (!this.fetchQueue) {
    // Kick off the request
    this.fetchQueue = [options];
    options = _.defaults({
      success: flushQueue(this, this.fetchQueue, 'success'),
      error: flushQueue(this, this.fetchQueue, 'error'),
      complete: flushQueue(this, this.fetchQueue, 'complete')
    }, options);

    // Handle callers that do not pass in a super class and wish to implement their own
    // fetch behavior
    if ($super) {
      $super.call(this, options);
    }
    return options;
  } else {
    // Currently fetching. Queue and process once complete
    this.fetchQueue.push(options);
  }
}

function flushQueue(self, fetchQueue, handler) {
  return function() {
    var args = arguments;

    // Flush the queue. Executes any callback handlers that
    // may have been passed in the fetch options.
    _.each(fetchQueue, function(options) {
      if (options[handler]) {
        options[handler].apply(this, args);
      }
    }, this);

    // Reset the queue if we are still the active request
    if (self.fetchQueue === fetchQueue) {
      self.fetchQueue = undefined;
    }
  };
}

var klasses = [];
Thorax.Model && klasses.push(Thorax.Model);
Thorax.Collection && klasses.push(Thorax.Collection);

_.each(klasses, function(DataClass) {
  var $fetch = DataClass.prototype.fetch;
  Thorax.mixinLoadableEvents(DataClass.prototype, false);
  _.extend(DataClass.prototype, {
    sync: Thorax.sync,

    fetch: function(options) {
      options = options || {};
      if (DataClass === Thorax.Collection) {
        if (!_.find(['reset', 'remove', 'add', 'update'], function(key) { return !_.isUndefined(options[key]); })) {
          // use backbone < 1.0 behavior to allow triggering of reset events
          options.reset = true;
        }
      }

      if (!options.loadTriggered) {
        var self = this;

        function endWrapper(method) {
          var $super = options[method];
          options[method] = function() {
            self.loadEnd();
            $super && $super.apply(this, arguments);
          };
        }

        endWrapper('success');
        endWrapper('error');
        self.loadStart(undefined, options.background);
      }

      return fetchQueue.call(this, options || {}, $fetch);
    },

    load: function(callback, failback, options) {
      if (arguments.length === 2 && !_.isFunction(failback)) {
        options = failback;
        failback = false;
      }

      options = options || {};
      if (!options.background && !this.isPopulated() && rootObject) {
        // Make sure that the global scope sees the proper load events here
        // if we are loading in standalone mode
        if (this.isLoading()) {
          // trigger directly because load:start has already been triggered
          rootObject.trigger(loadStart, options.message, options.background, this);
        } else {
          Thorax.forwardLoadEvents(this, rootObject, true);
        }
      }

      loadData.call(this, callback, failback, options);
    }
  });
});

Thorax.Util.bindToRoute = bindToRoute;

// Propagates loading view parameters to the AJAX layer
Thorax.View.prototype._modifyDataObjectOptions = function(dataObject, options) {
  options.ignoreErrors = this.ignoreFetchError;
  options.background = this.nonBlockingLoad;
  return options;
};

// Thorax.CollectionHelperView inherits from CollectionView
// not HelperView so need to set it manually
Thorax.HelperView.prototype._modifyDataObjectOptions = Thorax.CollectionHelperView.prototype._modifyDataObjectOptions = function(dataObject, options) {
  options.ignoreErrors = this.parent.ignoreFetchError;
  options.background = this.parent.nonBlockingLoad;
  return options;
};

inheritVars.collection.loading = function() {
  var loadingView = this.loadingView,
      loadingTemplate = this.loadingTemplate,
      loadingPlacement = this.loadingPlacement;
  //add "loading-view" and "loading-template" options to collection helper
  if (loadingView || loadingTemplate) {
    var callback = Thorax.loadHandler(_.bind(function() {
      var item;
      if (this.collection.length === 0) {
        this.$el.empty();
      }
      if (loadingView) {
        var instance = Thorax.Util.getViewInstance(loadingView);
        this._addChild(instance);
        if (loadingTemplate) {
          instance.render(loadingTemplate);
        } else {
          instance.render();
        }
        item = instance;
      } else {
        item = this.renderTemplate(loadingTemplate);
      }
      var index = loadingPlacement
        ? loadingPlacement.call(this)
        : this.collection.length
      ;
      this.appendItem(item, index);
      this.$el.children().eq(index).attr('data-loading-element', this.collection.cid);
    }, this), _.bind(function() {
      this.$el.find('[data-loading-element="' + this.collection.cid + '"]').remove();
    }, this),
    this.collection);

    this.listenTo(this.collection, 'load:start', callback);
  }
};

if (Thorax.CollectionHelperView) {
  _.extend(Thorax.CollectionHelperView.attributeWhiteList, {
    'loading-template': 'loadingTemplate',
    'loading-view': 'loadingView',
    'loading-placement': 'loadingPlacement'
  });
}

Thorax.View.on({
  'load:start': Thorax.loadHandler(
      function(message, background, object) {
        this.onLoadStart(message, background, object);
      },
      function(background, object) {
        this.onLoadEnd(object);
      }),

  collection: {
    'load:start': function(message, background, object) {
      this.trigger(loadStart, message, background, object);
    }
  },
  model: {
    'load:start': function(message, background, object) {
      this.trigger(loadStart, message, background, object);
    }
  }
});

;;
Handlebars.registerHelper('loading', function(options) {
  var view = getOptionsData(options).view;
  view.off('change:load-state', onLoadStateChange, view);
  view.on('change:load-state', onLoadStateChange, view);
  return view._isLoading ? options.fn(this) : options.inverse(this);
});

function onLoadStateChange() {
  this.render();
}
;;
/*global _replaceHTML */
var isIE = (/msie [\w.]+/).exec(navigator.userAgent.toLowerCase());

if (isIE) {
  // IE will lose a reference to the elements if view.el.innerHTML = '';
  // If they are removed one by one the references are not lost.
  // For instance a view's childrens' `el`s will be lost if the view
  // sets it's `el.innerHTML`.
  Thorax.View.on('before:append', function() {
    // note that detach is not available in Zepto,
    // but IE should never run with Zepto
    if (this._renderCount > 0) {
      _.each(this._elementsByCid, function(element) {
        $(element).detach();
      });
      _.each(this.children, function(child) {
        child.$el.detach();
      });
    }
  });

  // Once nodes are detached their innerHTML gets nuked in IE
  // so create a deep clone. This method is identical to the
  // main implementation except for ".clone(true, true)" which
  // will perform a deep clone with events and data
  Thorax.CollectionView.prototype._replaceHTML = function(html) {
    if (this.getObjectOptions(this.collection) && this._renderCount) {
      var element;
      var oldCollectionElement = this.getCollectionElement().clone(true, true);
      element = _replaceHTML.call(this, html);
      if (!oldCollectionElement.attr('data-view-cid')) {
        this.getCollectionElement().replaceWith(oldCollectionElement);
      }
    } else {
      return _replaceHTML.call(this, html);
    }
  };
}

;;


})();

//@ sourceMappingURL=thorax.js.map
;
define("thorax", ["handlebars","backbone"], (function (global) {
    return function () {
        var ret, fn;
        return ret || global.Thorax;
    };
}(this)));


(function() {
  var __hasProp = {}.hasOwnProperty,
    __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; };

  define('cs!layout-view',['thorax'], function(Thorax) {
    var LayoutView;
    return LayoutView = (function(_super) {

      __extends(LayoutView, _super);

      function LayoutView() {
        return LayoutView.__super__.constructor.apply(this, arguments);
      }

      return LayoutView;

    })(Thorax.LayoutView);
  });

}).call(this);

define('hbs',["handlebars"], function(Handlebars) {
  var buildMap = {},
      templateExtension = ".hbs";

  return {

    // http://requirejs.org/docs/plugins.html#apiload
    load: function (name, parentRequire, onload, config) {

      // Get the template extension.
      var ext = (config.hbs && config.hbs.templateExtension ? config.hbs.templateExtension : templateExtension);

      if (config.isBuild) {
        // Use node.js file system module to load the template.
        // Sorry, no Rhino support.
        var fs = nodeRequire("fs");
        var fsPath = config.dirBaseUrl + "/" + name + ext;
        buildMap[name] = fs.readFileSync(fsPath).toString();
        onload();
      } else {
        // In browsers use the text-plugin to the load template. This way we
        // don't have to deal with ajax stuff
        parentRequire(["text!" + name + ext], function(raw) {
          // Just return the compiled template
          onload(Handlebars.compile(raw));
        });
      }

    },

    // http://requirejs.org/docs/plugins.html#apiwrite
    write: function (pluginName, name, write) {
      var compiled = Handlebars.precompile(buildMap[name]);
      // Write out precompiled version of the template function as AMD
      // definition.
      write(
        "define('hbs!" + name + "', ['handlebars'], function(Handlebars){ \n" +
          "return Handlebars.template(" + compiled.toString() + ");\n" +
        "});\n"
      );
    }

  };
});


define('hbs!templates/root', ['handlebars'], function(Handlebars){ 
return Handlebars.template(function (Handlebars,depth0,helpers,partials,data) {
  this.compilerInfo = [4,'>= 1.0.0'];
helpers = this.merge(helpers, Handlebars.helpers); data = data || {};
  var buffer = "", stack1, functionType="function", escapeExpression=this.escapeExpression;


  buffer += "\n    \n";
  if (stack1 = helpers['layout-element']) { stack1 = stack1.call(depth0, {hash:{},data:data}); }
  else { stack1 = depth0['layout-element']; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  buffer += escapeExpression(stack1)
    + "\n";
  return buffer;
  });
});


(function() {
  var __hasProp = {}.hasOwnProperty,
    __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; };

  define('cs!views/root',['cs!layout-view', 'hbs!templates/root'], function(LayoutView, rootTemplate) {
    var RootView, instance;
    RootView = (function(_super) {

      __extends(RootView, _super);

      function RootView() {
        return RootView.__super__.constructor.apply(this, arguments);
      }

      RootView.prototype.name = 'root';

      RootView.prototype.template = rootTemplate;

      return RootView;

    })(LayoutView);
    instance = null;
    RootView.getInstance = function(target) {
      if (!instance) {
        instance = new RootView();
        instance.appendTo(target || document.body);
      }
      return instance;
    };
    return RootView;
  });

}).call(this);


(function() {
  var __hasProp = {}.hasOwnProperty,
    __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; };

  define('cs!view',['thorax'], function(Thorax) {
    var View;
    return View = (function(_super) {

      __extends(View, _super);

      function View() {
        return View.__super__.constructor.apply(this, arguments);
      }

      return View;

    })(Thorax.View);
  });

}).call(this);


define('hbs!templates/guideguide', ['handlebars'], function(Handlebars){ 
return Handlebars.template(function (Handlebars,depth0,helpers,partials,data) {
  this.compilerInfo = [4,'>= 1.0.0'];
helpers = this.merge(helpers, Handlebars.helpers); data = data || {};
  var buffer = "", stack1, options, functionType="function", escapeExpression=this.escapeExpression, helperMissing=helpers.helperMissing;


  buffer += "<div class=\"header\">\n\n  <div class=\"header-wrapper\">\n\n    <h3 class=\"js-header-title\"><span class=\"overflow\">";
  if (stack1 = helpers.headerTitle) { stack1 = stack1.call(depth0, {hash:{},data:data}); }
  else { stack1 = depth0.headerTitle; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  buffer += escapeExpression(stack1)
    + "</span></h3>\n\n    ";
  options = {hash:{},data:data};
  buffer += escapeExpression(((stack1 = helpers.view || depth0.view),stack1 ? stack1.call(depth0, depth0.tabs, options) : helperMissing.call(depth0, "view", depth0.tabs, options)))
    + "\n  </div> <!-- /.header-wrapper -->\n\n</div>\n\n<hr />\n\n<div class=\"js-tabbed-pages\">\n\n  <div data-tab=\"form\" class=\"tabbed-page js-main-tab is-active\">\n    <div class=\"push-below-tabs\">\n      <div class=\"side-padding\">\n        ";
  options = {hash:{},data:data};
  buffer += escapeExpression(((stack1 = helpers.view || depth0.view),stack1 ? stack1.call(depth0, depth0.formView, options) : helperMissing.call(depth0, "view", depth0.formView, options)))
    + "\n      </div>\n    </div>\n  </div>\n\n  <div data-tab=\"custom\" class=\"tabbed-page js-main-tab\">\n    <div class=\"push-below-tabs\">\n      <div class=\"side-padding\">\n        ";
  options = {hash:{},data:data};
  buffer += escapeExpression(((stack1 = helpers.view || depth0.view),stack1 ? stack1.call(depth0, depth0.customView, options) : helperMissing.call(depth0, "view", depth0.customView, options)))
    + "\n      </div>\n    </div>\n  </div>\n\n  <div data-tab=\"saved\" class=\"tabbed-page js-main-tab\">\n    <div class=\"side-padding\">\n      ";
  options = {hash:{},data:data};
  buffer += escapeExpression(((stack1 = helpers.view || depth0.view),stack1 ? stack1.call(depth0, depth0.savedGrids, options) : helperMissing.call(depth0, "view", depth0.savedGrids, options)))
    + "\n    </div>\n  </div>\n\n</div>\n\n";
  options = {hash:{},data:data};
  buffer += escapeExpression(((stack1 = helpers.view || depth0.view),stack1 ? stack1.call(depth0, depth0.porter, options) : helperMissing.call(depth0, "view", depth0.porter, options)))
    + "\n\n";
  options = {hash:{},data:data};
  buffer += escapeExpression(((stack1 = helpers.view || depth0.view),stack1 ? stack1.call(depth0, depth0.alert, options) : helperMissing.call(depth0, "view", depth0.alert, options)))
    + "\n";
  return buffer;
  });
});


(function() {

  define('cs!lib/messages',[],function() {
    var Messages;
    return Messages = {
      locale: "en_us",
      supportedLocales: ["en_us", "fr_fr", "pt_br", "es_es", "pl_pl", "it_it"],
      get: function(key, data) {
        var _ref, _ref1;
        if ((_ref = this.library[key]) != null ? _ref[this.locale] : void 0) {
          return this.library[key][this.locale](data);
        }
        if ((_ref1 = this.library[key]) != null ? _ref1["en_us"] : void 0) {
          return this.library[key]["en_us"](data);
        }
        return "";
      },
      library: {
        tabForm: {
          en_us: function() {
            return "辅助线";
          },
          fr_fr: function() {
            return "Création";
          },
          pt_br: function() {
            return "Formulário";
          },
          es_es: function() {
            return "Formulario";
          },
          pl_pl: function() {
            return "Układ";
          },
          it_it: function() {
            return "Crea";
          }
        },
        tabCustom: {
          en_us: function() {
            return "自定义";
          },
          fr_fr: function() {
            return "Code";
          },
          pt_br: function() {
            return "Customizado";
          },
          es_es: function() {
            return "Personalizado";
          },
          pl_pl: function() {
            return "Własne";
          },
          it_it: function() {
            return "Personalizzato";
          }
        },
        tabSaved: {
          en_us: function() {
            return "库";
          },
          fr_fr: function() {
            return "Collection";
          },
          pt_br: function() {
            return "Salvo";
          },
          es_es: function() {
            return "Guardado";
          },
          pl_pl: function() {
            return "Zapisane";
          },
          it_it: function() {
            return "Preferiti";
          }
        },
        btnAddGuides: {
          en_us: function() {
            return "生成辅助线";
          },
          fr_fr: function() {
            return "Ajouter les repères";
          },
          pt_br: function() {
            return "Adicionar guias";
          },
          es_es: function() {
            return "Añadir guías";
          },
          pl_pl: function() {
            return "Dodaj linie pomocnicze";
          },
          it_it: function() {
            return "Aggiungi guide";
          }
        },
        btnOk: {
          en_us: function() {
            return "确定";
          },
          fr_fr: function() {
            return "Ok";
          },
          pt_br: function() {
            return "Ok";
          },
          es_es: function() {
            return "Ok";
          },
          pl_pl: function() {
            return "OK";
          },
          it_it: function() {
            return "Ok";
          }
        },
        btnYes: {
          en_us: function() {
            return "是";
          },
          fr_fr: function() {
            return "Oui";
          },
          pt_br: function() {
            return "Sim";
          },
          es_es: function() {
            return "Si";
          },
          pl_pl: function() {
            return "Tak";
          },
          it_it: function() {
            return "Sì";
          }
        },
        btnNo: {
          en_us: function() {
            return "否";
          },
          fr_fr: function() {
            return "Non";
          },
          pt_br: function() {
            return "Não";
          },
          es_es: function() {
            return "No";
          },
          pl_pl: function() {
            return "Nie";
          },
          it_it: function() {
            return "No";
          }
        },
        btnWhatIsThis: {
          en_us: function() {
            return "这是什么?";
          },
          fr_fr: function() {
            return "Qu'est-ce que c'est ?";
          },
          pt_br: function() {
            return "O que é isso?";
          },
          es_es: function() {
            return "¿Qué es esto?";
          },
          pl_pl: function() {
            return "Co to jest?";
          },
          it_it: function() {
            return "Cos'è questo?";
          }
        },
        btnSaveGrid: {
          en_us: function() {
            return "保存栅格";
          },
          fr_fr: function() {
            return "Enregistrer la grille";
          },
          pt_br: function() {
            return "Salvar grid";
          },
          es_es: function() {
            return "Guardar retícula";
          },
          pl_pl: function() {
            return "Zapisz wzorzec";
          },
          it_it: function() {
            return "Salva griglia";
          }
        },
        btnCancel: {
          en_us: function() {
            return "取消";
          },
          fr_fr: function() {
            return "Annuler";
          },
          pt_br: function() {
            return "Cancelar";
          },
          es_es: function() {
            return "Cancelar";
          },
          pl_pl: function() {
            return "Anuluj";
          },
          it_it: function() {
            return "Annulla";
          }
        },
        btnResetForm: {
          en_us: function() {
            return "清空参数";
          },
          fr_fr: function() {
            return "Effacer";
          },
          pt_br: function() {
            return "Resetar formulário";
          },
          es_es: function() {
            return "Resetear formulario";
          },
          pl_pl: function() {
            return "Zresetuj układ";
          },
          it_it: function() {
            return "Resetta i campi";
          }
        },
        btnLearnMore: {
          en_us: function() {
            return "了解更多";
          },
          fr_fr: function() {
            return "En savoir plus";
          },
          pt_br: function() {
            return "Aprenda mais";
          },
          es_es: function() {
            return "Saber más";
          },
          pl_pl: function() {
            return "Dowiedz się więcej";
          },
          it_it: function() {
            return "Per saperne di più";
          }
        },
        inputColumns: {
          en_us: function() {
            return "列";
          },
          fr_fr: function() {
            return "Colonnes";
          },
          pt_br: function() {
            return "Colunas";
          },
          es_es: function() {
            return "Colunas";
          },
          pl_pl: function() {
            return "Kolumny";
          },
          it_it: function() {
            return "Colonne";
          }
        },
        btnEditSelected: {
          en_us: function() {
            return "编辑";
          },
          fr_fr: function() {
            return "Modifier la sélection";
          },
          pt_br: function() {
            return "Editar selecionados";
          },
          es_es: function() {
            return "Editar seleccionados";
          },
          pl_pl: function() {
            return "Edytuj zaznaczone";
          },
          it_it: function() {
            return "Modifica la selezione";
          }
        },
        btnDeleteSelected: {
          en_us: function() {
            return "删除";
          },
          fr_fr: function() {
            return "Supprimer la sélection";
          },
          pt_br: function() {
            return "Deletar selecionados";
          },
          es_es: function() {
            return "Borrar seleccionados";
          },
          pl_pl: function() {
            return "Skasuj zaznaczone";
          },
          it_it: function() {
            return "Cancella selezionati";
          }
        },
        btnImport: {
          en_us: function() {
            return "导入";
          },
          fr_fr: function() {
            return "Importation";
          },
          pt_br: function() {
            return "Importar";
          },
          es_es: function() {
            return "Importar";
          },
          pl_pl: function() {
            return "Import";
          },
          it_it: function() {
            return "Importa";
          }
        },
        btnExport: {
          en_us: function() {
            return "导出";
          },
          fr_fr: function() {
            return "Exportation";
          },
          pt_br: function() {
            return "Exportar";
          },
          es_es: function() {
            return "Exportar";
          },
          pl_pl: function() {
            return "Eksport";
          },
          it_it: function() {
            return "Esporta";
          }
        },
        btnAddDefaultGrids: {
          en_us: function() {
            return "添加默认栅格";
          },
          fr_fr: function() {
            return "Ajouter les grilles par défaut";
          },
          pt_br: function() {
            return "Adicionar grids padrões";
          },
          es_es: function() {
            return "Añadir retículas por defecto";
          },
          pl_pl: function() {
            return "Dodaj domyślne wzorce";
          },
          it_it: function() {
            return "Aggiungi griglie di default";
          }
        },
        btnFromAFile: {
          en_us: function() {
            return "从文件";
          },
          fr_fr: function() {
            return "À partir d'un fichier";
          },
          pt_br: function() {
            return "A partir de um arquivo";
          },
          es_es: function() {
            return "Desde un fichero";
          },
          pl_pl: function() {
            return "Z pliku";
          },
          it_it: function() {
            return "Da un file";
          }
        },
        btnFromAGitHubGist: {
          en_us: function() {
            return "从 GitHub Gist";
          },
          fr_fr: function() {
            return "À partir d'un Gist de GitHub";
          },
          pt_br: function() {
            return "A partir de um Gist do GitHub";
          },
          es_es: function() {
            return "Desde un Gist de GitHub";
          },
          pl_pl: function() {
            return "Z Gistu GitHub";
          },
          it_it: function() {
            return "Da un Gist Github";
          }
        },
        btnToAFile: {
          en_us: function() {
            return "另存为文件";
          },
          fr_fr: function() {
            return "Dans un fichier";
          },
          pt_br: function() {
            return "Para um arquivo";
          },
          es_es: function() {
            return "A un fichero";
          },
          pl_pl: function() {
            return "Do pliku";
          },
          it_it: function() {
            return "In un file";
          }
        },
        btnToAGitHubGist: {
          en_us: function() {
            return "上传到 GitHub Gist";
          },
          fr_fr: function() {
            return "Vers un Gist de GitHub";
          },
          pt_br: function() {
            return "Para um Gist do GitHub";
          },
          es_es: function() {
            return "A un Gist de GitHub";
          },
          pl_pl: function() {
            return "Do Gistu GitHub";
          },
          it_it: function() {
            return "In un Gist di Github";
          }
        },
        btnNewFromExisting: {
          en_us: function() {
            return "将辅助线保存为栅格";
          },
          fr_fr: function() {
            return "Nouvelle grille à partir des repères existants";
          },
          pt_br: function() {
            return "Novo grid a partir de um grid já existente";
          },
          es_es: function() {
            return "Nueva retícula a partir de las guías existentes";
          },
          pl_pl: function() {
            return "Nowy wzorzec z aktualnych linii pomocniczych";
          },
          it_it: function() {
            return "Nuova griglia da guide esistenti";
          }
        },
        inputWidth: {
          en_us: function() {
            return "列宽";
          },
          fr_fr: function() {
            return "Largeur";
          },
          pt_br: function() {
            return "Largura";
          },
          es_es: function() {
            return "Anchura";
          },
          pl_pl: function() {
            return "Szerokość";
          },
          it_it: function() {
            return "Larghezza";
          }
        },
        inputHeight: {
          en_us: function() {
            return "行高";
          },
          fr_fr: function() {
            return "Hauteur";
          },
          pt_br: function() {
            return "Altura";
          },
          es_es: function() {
            return "Altura";
          },
          pl_pl: function() {
            return "Wysokość";
          },
          it_it: function() {
            return "Altezza";
          }
        },
        inputGutter: {
          en_us: function() {
            return "余边";
          },
          fr_fr: function() {
            return "Gouttière";
          },
          pt_br: function() {
            return "Gutter";
          },
          es_es: function() {
            return "Gutter";
          },
          pl_pl: function() {
            return "Odstęp";
          },
          it_it: function() {
            return "Spaziatura";
          }
        },
        inputMargin: {
          en_us: function() {
            return "边距";
          },
          fr_fr: function() {
            return "Marge";
          },
          pt_br: function() {
            return "Margem";
          },
          es_es: function() {
            return "Margen";
          },
          pl_pl: function() {
            return "Margines";
          },
          it_it: function() {
            return "Margini";
          }
        },
        inputColumns: {
          en_us: function() {
            return "列数";
          },
          fr_fr: function() {
            return "Colonnes";
          },
          pt_br: function() {
            return "Colunas";
          },
          es_es: function() {
            return "Colunas";
          },
          pl_pl: function() {
            return "Kolumny";
          },
          it_it: function() {
            return "Colonne";
          }
        },
        inputRows: {
          en_us: function() {
            return "行数";
          },
          fr_fr: function() {
            return "Rangées";
          },
          pt_br: function() {
            return "Linhas";
          },
          es_es: function() {
            return "Filas";
          },
          pl_pl: function() {
            return "Wiersze";
          },
          it_it: function() {
            return "Righe";
          }
        },
        inputGitHubGistURL: {
          en_us: function() {
            return "GitHub Gist 地址或 ID";
          },
          fr_fr: function() {
            return "URL ou ID du Gist de GitHub";
          },
          pt_br: function() {
            return "URL ou ID de um Gist do GitHub";
          },
          es_es: function() {
            return "URL o ID de un Gist de GitHub";
          },
          pl_pl: function() {
            return "URL lub ID Gistu GitHub";
          },
          it_it: function() {
            return "URL o ID del Gist di Github";
          }
        },
        dropdownLeft: {
          en_us: function() {
            return "左对齐";
          },
          fr_fr: function() {
            return "Gauche";
          },
          pt_br: function() {
            return "Esquerda";
          },
          es_es: function() {
            return "Izquierda";
          },
          pl_pl: function() {
            return "Lewa";
          },
          it_it: function() {
            return "Sinistra";
          }
        },
        dropdownCenter: {
          en_us: function() {
            return "居中";
          },
          fr_fr: function() {
            return "Centre";
          },
          pt_br: function() {
            return "Centro";
          },
          es_es: function() {
            return "Centro";
          },
          pl_pl: function() {
            return "Środkowa";
          },
          it_it: function() {
            return "Centro";
          }
        },
        dropdownRight: {
          en_us: function() {
            return "右对齐";
          },
          fr_fr: function() {
            return "Droite";
          },
          pt_br: function() {
            return "Direita";
          },
          es_es: function() {
            return "Derecha";
          },
          pl_pl: function() {
            return "Prawa";
          },
          it_it: function() {
            return "Destra";
          }
        },
        dropdownTop: {
          en_us: function() {
            return "上对齐";
          },
          fr_fr: function() {
            return "Haut";
          },
          pt_br: function() {
            return "Topo";
          },
          es_es: function() {
            return "Arriba";
          },
          pl_pl: function() {
            return "Górna";
          },
          it_it: function() {
            return "Sopra";
          }
        },
        dropdownBottom: {
          en_us: function() {
            return "下对齐";
          },
          fr_fr: function() {
            return "Bas";
          },
          pt_br: function() {
            return "Baixo";
          },
          es_es: function() {
            return "Abajo";
          },
          pl_pl: function() {
            return "Dolna";
          },
          it_it: function() {
            return "Sotto";
          }
        },
        blankslateGrids: {
          en_us: function() {
            return "无栅格! 是否保存或…";
          },
          fr_fr: function() {
            return "Vous n'avez aucune grille ! Enregistrer la vôtre ou…";
          },
          pt_br: function() {
            return "Você ainda não tem nenhum grid! Crie os seus próprios…";
          },
          es_es: function() {
            return "¡No hay ninguna retícula definida! Guarda la tuya o…";
          },
          pl_pl: function() {
            return "Nie masz jeszcze wzorców! Zapisz swój własny lub…";
          },
          it_it: function() {
            return "Non hai ancora alcuna griglia. Salvane una o…";
          }
        },
        placeholderCustom: {
          en_us: function() {
            return "自定义栅格内容";
          },
          fr_fr: function() {
            return "Écriver ici la synthaxe de votre grille";
          },
          pt_br: function() {
            return "Escreva anotações sobre o seu grid aqui";
          },
          es_es: function() {
            return "Escribe aquí la notación de retícula";
          },
          pl_pl: function() {
            return "Wpisz tutaj definicję w odpowiedniej notacji";
          },
          it_it: function() {
            return "Scrivi qui il codice della tua griglia";
          }
        },
        placeholderName: {
          en_us: function() {
            return "栅格名称";
          },
          fr_fr: function() {
            return "Nommer votre grille";
          },
          pt_br: function() {
            return "Nomeie o seu grid";
          },
          es_es: function() {
            return "Nombra tu retícula";
          },
          pl_pl: function() {
            return "Nazwij swój wzorzec";
          },
          it_it: function() {
            return "Dai un nome alla tua griglia";
          }
        },
        titleUntitledGrid: {
          en_us: function() {
            return "未命名栅格";
          },
          fr_fr: function() {
            return "Sans titre";
          },
          pt_br: function() {
            return "Grid sem Nome";
          },
          es_es: function() {
            return "Retícula Sin Título";
          },
          pl_pl: function() {
            return "Nienazwany wzorzec";
          },
          it_it: function() {
            return "Griglia senza titolo";
          }
        },
        titleOutline: {
          en_us: function() {
            return "轮廓";
          },
          fr_fr: function() {
            return "Contours";
          },
          pt_br: function() {
            return "Contorno";
          },
          es_es: function() {
            return "Contorno";
          },
          pl_pl: function() {
            return "Kontur";
          },
          it_it: function() {
            return "Contorno";
          }
        },
        titleTwoColumnGrid: {
          en_us: function() {
            return "双列栅格";
          },
          fr_fr: function() {
            return "Deux colonnes";
          },
          pt_br: function() {
            return "Grid com duas colunas";
          },
          es_es: function() {
            return "Retícula de dos columnas";
          },
          pl_pl: function() {
            return "Dwie kolumny";
          },
          it_it: function() {
            return "Griglia a due colonne";
          }
        },
        titleThreeColumnGrid: {
          en_us: function() {
            return "三列栅格";
          },
          fr_fr: function() {
            return "Trois colonnes";
          },
          pt_br: function() {
            return "Grid com três colunas";
          },
          es_es: function() {
            return "Retícula de tres columnas";
          },
          pl_pl: function() {
            return "Trzy kolumny";
          },
          it_it: function() {
            return "Griglia a tre colonne";
          }
        },
        titleSaveYourGrid: {
          en_us: function() {
            return "保存栅格";
          },
          fr_fr: function() {
            return "Enregistrer votre grille";
          },
          pt_br: function() {
            return "Salve o seu grid";
          },
          es_es: function() {
            return "Guarda tu retícula";
          },
          pl_pl: function() {
            return "Zapisz swój wzorzec";
          },
          it_it: function() {
            return "Salva la tua griglia";
          }
        },
        titleImportGrids: {
          en_us: function() {
            return "导入栅格";
          },
          fr_fr: function() {
            return "Importer des grilles";
          },
          pt_br: function() {
            return "Importe grids";
          },
          es_es: function() {
            return "Importar reticulas";
          },
          pl_pl: function() {
            return "Importuj wzorce";
          },
          it_it: function() {
            return "Importa griglie";
          }
        },
        titleExportGrids: {
          en_us: function() {
            return "导出栅格";
          },
          fr_fr: function() {
            return "Exporter des grilles";
          },
          pt_br: function() {
            return "Exporte grids";
          },
          es_es: function() {
            return "Exportar retículas";
          },
          pl_pl: function() {
            return "Eksportuj wzorce";
          },
          it_it: function() {
            return "Esporta griglie";
          }
        },
        titleExportError: {
          en_us: function() {
            return "导出错误";
          },
          fr_fr: function() {
            return "Erreur lors de l'export";
          },
          pt_br: function() {
            return "Exporte o erro";
          },
          es_es: function() {
            return "Error de exportación";
          },
          pl_pl: function() {
            return "Błąd podczas eksportu";
          },
          it_it: function() {
            return "Errore durante l'esportazione";
          }
        },
        tooltipLeftBorder: {
          en_us: function() {
            return "左边";
          },
          fr_fr: function() {
            return "Bord gauche";
          },
          pt_br: function() {
            return "Borda da esquerda";
          },
          es_es: function() {
            return "Borde izquierdo";
          },
          pl_pl: function() {
            return "Lewy margines";
          },
          it_it: function() {
            return "Bordo sinistro";
          }
        },
        tooltipRightBorder: {
          en_us: function() {
            return "右边";
          },
          fr_fr: function() {
            return "Bord droite";
          },
          pt_br: function() {
            return "Borda da direita";
          },
          es_es: function() {
            return "Borde derecho";
          },
          pl_pl: function() {
            return "Prawy margines";
          },
          it_it: function() {
            return "Bordo destro";
          }
        },
        tooltipTopBorder: {
          en_us: function() {
            return "顶边";
          },
          fr_fr: function() {
            return "Bord supérieur";
          },
          pt_br: function() {
            return "Borda superior";
          },
          es_es: function() {
            return "Borde superior";
          },
          pl_pl: function() {
            return "Górny margines";
          },
          it_it: function() {
            return "Bordo superiore";
          }
        },
        tooltipBottomBorder: {
          en_us: function() {
            return "底边";
          },
          fr_fr: function() {
            return "Bord inférieur";
          },
          pt_br: function() {
            return "Borda inferior";
          },
          es_es: function() {
            return "Borde inferior";
          },
          pl_pl: function() {
            return "Dolny margines";
          },
          it_it: function() {
            return "Bordo inferiore";
          }
        },
        tooltipMidpoint: {
          en_us: function() {
            return "中心";
          },
          fr_fr: function() {
            return "Centre";
          },
          pt_br: function() {
            return "Ponto médio";
          },
          es_es: function() {
            return "Punto medio";
          },
          pl_pl: function() {
            return "Środek";
          },
          it_it: function() {
            return "Centro";
          }
        },
        tooltipClearGuides: {
          en_us: function() {
            return "清除";
          },
          fr_fr: function() {
            return "Effacer les repères";
          },
          pt_br: function() {
            return "Limpar guias";
          },
          es_es: function() {
            return "Limpiar guías";
          },
          pl_pl: function() {
            return "Skasuj linie pomocnicze";
          },
          it_it: function() {
            return "Cancella guide";
          }
        },
        tooltipToggleGuideVisibility: {
          en_us: function() {
            return "显示/隐藏";
          },
          fr_fr: function() {
            return "Afficher/masquer les repères";
          },
          pt_br: function() {
            return "Alternar a visibilidade da guia";
          },
          es_es: function() {
            return "Alternar visibilidad de guías";
          },
          pl_pl: function() {
            return "Przełącz widoczność wzorca";
          },
          it_it: function() {
            return "Mostra/nascondi guide";
          }
        },
        msgGistDescription: {
          en_us: function() {
            return "此栅格数据由 GuideGuide 插件导出";
          },
          fr_fr: function() {
            return "          Voici les données d'une grille exportées par le plugin GuideGuide.        ";
          },
          pt_br: function() {
            return "          Estes são os dados de grids exportados pelo plugin GuideGuide.        ";
          },
          es_es: function() {
            return "          Estos son datos de retícula exportados por el plugin GuideGuide.        ";
          },
          pl_pl: function() {
            return "To są dane wzorca wyeksportowane przez wtyczkę GuideGuide.";
          },
          it_it: function() {
            return "Dati griglia esportati dal plugin GuideGuide";
          }
        },
        msgCustomUpsell: {
          en_us: function() {
            return "购买完整版本可创建更多栅格";
          },
          fr_fr: function() {
            return "          Acheter la version complète pour créer toutes les grilles que vous          pouvez imaginer.        ";
          },
          pt_br: function() {
            return "          Compre a versão completa para criar qualquer tipo de grid que você          puder imaginar.        ";
          },
          es_es: function() {
            return "          Compra la versión completa para crear cualquier retícula que puedas          imaginar.        ";
          },
          pl_pl: function() {
            return "Kup pełną wersję i twórz wzorce jakie tylko zapragniesz.";
          },
          it_it: function() {
            return "           Acquista la versione completa per creare qualsiai griglia desideri        ";
          }
        },
        msgSavedUpsell: {
          en_us: function() {
            return "购买完整版本帮您节省更多时间";
          },
          fr_fr: function() {
            return "          Acheter la version complète pour enregistrer les grilles que vous          utiliser fréquemment.        ";
          },
          pt_br: function() {
            return "          Compre a versão completa para salvar quais grids você mais utiliza.        ";
          },
          es_es: function() {
            return "          Compra la versión completa para guardar tus retículas más habituales.        ";
          },
          pl_pl: function() {
            return "          Kup pełną wersję by móc zapisywać najczęściej używane wzorce.        ";
          },
          it_it: function() {
            return "           Acquista la versione completa per salvare le griglie che usi più spesso        ";
          }
        },
        msgQuickUpsell: {
          en_us: function() {
            return "购买完整版本添加与清除辅助线功能将更加迅速";
          },
          fr_fr: function() {
            return "          Acheter la verison complète pour effacer et ajouter des repères          facilement.          ";
          },
          pt_br: function() {
            return "          Compre a versão completa para criar e deletar guias de maneira mais          rápida.        ";
          },
          es_es: function() {
            return "          Compra la versión completa para borrar y añadir guías rápidamente.        ";
          },
          pl_pl: function() {
            return "          Kup pełną wersję by szybko usuwać i dodawać linie pomocnicze.        ";
          },
          it_it: function() {
            return "           Acquista la versione completa per cancellare e aggiungere griglie a piacimento        ";
          }
        },
        titleUpgradeToTheBundle: {
          en_us: function(app) {
            return "更新 " + app;
          }
        },
        msgUpgradeToTheBundle: {
          en_us: function(app) {
            return "          您使用 GuideGuide 已超过 30 次的试用限制! GuideGuide 也可以用于 " + app + "! 想要了解更多吗?        ";
          }
        },
        titleFreeVersion: {
          en_us: function() {
            return "免费版";
          },
          fr_fr: function() {
            return "Version gratuite";
          },
          pt_br: function() {
            return "Versão de graça";
          },
          es_es: function() {
            return "Versión gratuita";
          },
          pl_pl: function() {
            return "Wersja bezpłatna";
          },
          it_it: function() {
            return "Versione gratuita";
          }
        },
        msgFreeVersionEnabled: {
          en_us: function() {
            return "          GuideGuide 已超过 30 次试用限制! 请购买完整版本 !        ";
          },
          fr_fr: function() {
            return "          Vous avez utilisé GuideGuide 30 fois ! Vous pouvez acheter la version          complète pour réactiver toutes les fonctionnalités.        ";
          },
          pt_br: function() {
            return "          Você já usou GuideGuide 30 vezes! Você pode comprar a versão completa          para reabilitar todas as funcionalidades.        ";
          },
          es_es: function() {
            return "          ¡Has usado GuideGuide 30 veces! Puedes comprar la versión completa          para reactivar todas las funcionalidades.        ";
          },
          pl_pl: function() {
            return "          Użyto GuideGuide 30 razy! Możesz teraz kupić pełną wersją.        ";
          },
          it_it: function() {
            return "           Hai usato GuideGuide 30 volte! Puoi comprare la versione completa per sbloccare nuovamente tutte le funzionalità        ";
          }
        },
        titleGoogleAnalytics: {
          en_us: function() {
            return "反馈使用数据";
          },
          fr_fr: function() {
            return "Collecte des données d'utilisation";
          },
          pt_br: function() {
            return "Enviar dados de uso";
          },
          es_es: function() {
            return "Enviar datos de uso";
          },
          pl_pl: function() {
            return "Wysyłaj informacje o używaniu";
          },
          it_it: function() {
            return "Invia statistiche di utilizzo";
          }
        },
        msgGoogleAnalytics: {
          en_us: function() {
            return "          是否允许 GuideGuide 向谷歌发送匿名使用信息以帮助改进产品?        ";
          },
          fr_fr: function() {
            return "          Autoriser GuideGuide à utiliser Google Analytics pour collecter          anonymement des informations d'utilisation et aider à améliorer le          plugin ?        ";
          },
          pt_br: function() {
            return "          Você vai permitir que GuideGuide use o Google Analytics para          acompanhar, de forma anônima, informações da utilização do produto          para para ajudar a melhorá-lo?        ";
          },
          es_es: function() {
            return "          ¿Permitir a GuideGuide utilizar Google Analytics para mantener un          registro anónimo de uso con el fin de ayudar a mejorar el producto?        ";
          },
          pl_pl: function() {
            return "          Czy pozwolisz GuideGuide używać Google Analytics do śledzenia          anonimowych danych używania, aby ulepszyć produkt?        ";
          },
          it_it: function() {
            return "Autorizzi GuideGuide all'uso di Google Analytics per raccogliere anonimamente statistiche di utilizzo, allo scopo migliorare il plugin?";
          }
        },
        menuDuplicateToOpenDocuments: {
          en_us: function() {
            return "复制辅助线到已打开文档";
          },
          fr_fr: function() {
            return "Dupliquer les repères vers les documents ouverts";
          },
          pt_br: function() {
            return "Duplique os guias para os documentos abertos";
          },
          pl_pl: function() {
            return "Powiel linie pomocnicze w otwartych dokumentach";
          },
          it_it: function() {
            return "Duplica guide nei documenti aperti";
          }
        },
        menuDuplicateToArtboards: {
          en_us: function() {
            return "复制辅助线到剪贴板";
          },
          fr_fr: function() {
            return "Dupliquer les repères vers les plans de travail";
          },
          pt_br: function() {
            return "Duplique as guias para as áreas de trabalho";
          },
          pl_pl: function() {
            return "Powiel linie pomocnicze do obszaru kompozycji";
          },
          it_it: function() {
            return "Duplica guide nelle tavole da disegno";
          }
        },
        menuClearAllGuides: {
          en_us: function() {
            return "清除全部";
          },
          fr_fr: function() {
            return "Effacer tous les repères";
          },
          pt_br: function() {
            return "Limpar todos as guias";
          },
          pl_pl: function() {
            return "Skasuj wszystkie linie pomocnicze";
          },
          it_it: function() {
            return "Cancella tutte le guide";
          }
        },
        menuClearArtboardGuides: {
          en_us: function() {
            return "清除当前画板上辅助线";
          },
          fr_fr: function() {
            return "Effacer les repères du plan de travail";
          },
          pt_br: function() {
            return "Limpar todas as guias selecionadas da area de trabalho";
          },
          pl_pl: function() {
            return "Skasuj wszystkie linie pomocnicze na zaznaczonym obszarze kompozycji";
          },
          it_it: function() {
            return "Cancella le guide nelle tavole da disegno selezionate";
          }
        },
        menuClearCanvasGuides: {
          en_us: function() {
            return "清除画布上辅助线";
          },
          fr_fr: function() {
            return "Effacer les repères de la zone de travail";
          },
          pt_br: function() {
            return "Limpar todas as guias da tela";
          },
          pl_pl: function() {
            return "Skasuj linie pomocnicze na obszarze roboczym";
          },
          it_it: function() {
            return "Cancella le guide nell'area di lavoro";
          }
        },
        menuClearVerticalGuides: {
          en_us: function() {
            return "清除垂直辅助线";
          },
          fr_fr: function() {
            return "Effacer les repères verticaux";
          },
          pt_br: function() {
            return "Limpar todas as guias verticais";
          },
          pl_pl: function() {
            return "Skasuj pionowe linie pomocnicze";
          },
          it_it: function() {
            return "Cancella guide verticali";
          }
        },
        menuClearHorizontalGuides: {
          en_us: function() {
            return "清除水平辅助线";
          },
          fr_fr: function() {
            return "Effacer les repères horizontaux";
          },
          pt_br: function() {
            return "Limpar todas as guias horizontais";
          },
          pl_pl: function() {
            return "Skasuj poziome linie pomocnicze";
          },
          it_it: function() {
            return "Cancella guide orizzontali";
          }
        },
        menuTrackingSettings: {
          en_us: function() {
            return "跟踪设置";
          },
          fr_fr: function() {
            return "Préférences de suivi";
          },
          pt_br: function() {
            return "Configurações de rastreamento";
          },
          pl_pl: function() {
            return "Ustawienia śledzenia";
          },
          it_it: function() {
            return "Opzioni di condivisione";
          }
        },
        menuUninstall: {
          en_us: function() {
            return "卸载";
          },
          fr_fr: function() {
            return "Désinstaller";
          },
          pt_br: function() {
            return "Desinstalar";
          },
          pl_pl: function() {
            return "Odinstaluj";
          },
          it_it: function() {
            return "Disinstalla";
          }
        },
        menuDebug: {
          en_us: function() {
            return "调试";
          },
          fr_fr: function() {
            return "Débogage";
          },
          pt_br: function() {
            return "Depurar";
          },
          pl_pl: function() {
            return "Debug";
          },
          it_it: function() {
            return "Debug";
          }
        },
        menuUseLayers: {
          en_us: function() {
            return "使用选中图层";
          },
          fr_fr: function() {
            return "Utiliser les calques sélectionnés";
          },
          pt_br: function() {
            return "User as camadas selecionadas";
          }
        },
        menuBuyGuideGuide: {
          en_us: function() {
            return "购买 GuideGuide";
          },
          fr_fr: function() {
            return "Acheter GuideGuide";
          },
          pt_br: function() {
            return "Comprar GuideGuide";
          },
          pl_pl: function() {
            return "Kup GuideGuide";
          },
          it_it: function() {
            return "Acquista GuideGuide";
          }
        },
        menuUpgradeGuideGuide: {
          en_us: function(app) {
            return "获取 " + app + " 版";
          }
        },
        menuChangeDataFolder: {
          en_us: function() {
            return "更改数据文件夹";
          },
          fr_fr: function() {
            return "Modifier l'emplacement des données";
          },
          pt_br: function() {
            return "Alterar a pasta de dados";
          }
        },
        menuConvertSelectionToGuides: {
          en_us: function() {
            return "转换选中为辅助线";
          },
          fr_fr: function() {
            return "Convertir la sélection en repères";
          },
          pt_br: function() {
            return "Converter os guias selecionados";
          },
          it_it: function() {
            return "Cambia cartella delle preferenze";
          }
        },
        historyDuplicateGuidesFrom: {
          en_us: function() {
            return "复制辅助线从";
          },
          fr_fr: function() {
            return "Dupliquer les repères à partir de";
          },
          pt_br: function() {
            return "Duplicar guias de";
          },
          pl_pl: function() {
            return "Powiel linie pomocnicze z";
          },
          it_it: function() {
            return "Duplica guide da";
          }
        },
        errNotJSON: {
          en_us: function() {
            return "选择文件必须为 .json 文件";
          },
          fr_fr: function() {
            return "Le fichier doit être au format .json";
          },
          pt_br: function() {
            return "O arquivo selecionado tem que ser um arquivo .json";
          },
          es_es: function() {
            return "El fichero seleccionado debe ser un fichero .json";
          },
          pl_pl: function() {
            return "Wybrany plik musi być plikiem .json";
          },
          it_it: function() {
            return "Il file selezionato deve essere un .json";
          }
        },
        errFileRead: {
          en_us: function() {
            return "无法读取选择文件";
          },
          fr_fr: function() {
            return "Le fichier n'a pas pu être lu";
          },
          pt_br: function() {
            return "O arquivo selecionado não pode ser lido";
          },
          es_es: function() {
            return "El fichero seleccionado no pudo leerse";
          },
          pl_pl: function() {
            return "Nie można odczytać wybranego pliku";
          },
          it_it: function() {
            return "Il file selezionato non può essere letto";
          }
        },
        gnError1: {
          en_us: function() {
            return "无法识别命令";
          },
          fr_fr: function() {
            return "Commande inconnue";
          },
          pt_br: function() {
            return "Comando não reconhecido";
          },
          es_es: function() {
            return "Comando no reconocido";
          },
          pl_pl: function() {
            return "Nierozpoznana komenda";
          },
          it_it: function() {
            return "Comando sconosciuto";
          }
        },
        gnError2: {
          en_us: function() {
            return "该字串不包含任何栅格";
          },
          fr_fr: function() {
            return "La synthaxe ne contient aucune grille";
          },
          pt_br: function() {
            return "Este arquivo não contém nenhum grid";
          },
          es_es: function() {
            return "Esta cadena no contiene ninguna retícula";
          },
          pl_pl: function() {
            return "Ten ciąg znaków nie zawiera żadnych wzorców";
          },
          it_it: function() {
            return "Questa stringa non contiene alcuna griglia";
          }
        },
        gnError3: {
          en_us: function() {
            return "填充变量不能包含通配符";
          },
          fr_fr: function() {
            return "          Les variables utilisées comme itération ne peuvent pas contient de          métacaractère        ";
          },
          pt_br: function() {
            return "As variáveis não podem conter wildcards (*)";
          },
          es_es: function() {
            return "          Las variables usadas como relleno no pueden contener wildcards        ";
          },
          pl_pl: function() {
            return "Zmienne używane do wypełniania nie mogą zawierać wieloznaczników";
          },
          it_it: function() {
            return "Le variabili usate come ripetizioni non possono contenere caratteri jolly";
          }
        },
        gnError4: {
          en_us: function() {
            return "栅格不能包含多个填充";
          },
          fr_fr: function() {
            return "Une grille ne peut contenir qu'une seule itération";
          },
          pt_br: function() {
            return "Um grid não pode conter mais do que um valor";
          },
          es_es: function() {
            return "Una retícula no puede contener más de un relleno";
          },
          pl_pl: function() {
            return "Wzorzec nie może zawierać więcej niż jednego wypełnienia";
          },
          it_it: function() {
            return "Una griglia non può contenere più di un riempimento";
          }
        },
        gnError5: {
          en_us: function() {
            return "变量不能包含填充";
          },
          fr_fr: function() {
            return "Les variables ne peuvent pas contenir d'itération";
          },
          pt_br: function() {
            return "As variáveis não podem ser preenchidas";
          },
          es_es: function() {
            return "Las variables no pueden contener rellenos";
          },
          pl_pl: function() {
            return "Zmienne nie mogą zawierać wypełnień";
          },
          it_it: function() {
            return "Le variabili non possono contenere riempimenti";
          }
        },
        gnError6: {
          en_us: function() {
            return "未定义变量";
          },
          fr_fr: function() {
            return "Variable indéfinie";
          },
          pt_br: function() {
            return "Variável indefinida";
          },
          es_es: function() {
            return "Variable indefinida";
          },
          pl_pl: function() {
            return "Niezdefiniowana zmienna";
          },
          it_it: function() {
            return "Variabile non definita";
          }
        }
      }
    };
  });

}).call(this);


define('hbs!templates/tabs', ['handlebars'], function(Handlebars){ 
return Handlebars.template(function (Handlebars,depth0,helpers,partials,data) {
  this.compilerInfo = [4,'>= 1.0.0'];
helpers = this.merge(helpers, Handlebars.helpers); data = data || {};
  var buffer = "", stack1, stack2, functionType="function", escapeExpression=this.escapeExpression, self=this;

function program1(depth0,data) {
  
  var buffer = "", stack1;
  buffer += "\n        <a class=\"button\" href=\"\" data-tab=\"saved\" tabindex=\"-1\"><span class=\"overflow\">";
  if (stack1 = helpers.tabSaved) { stack1 = stack1.call(depth0, {hash:{},data:data}); }
  else { stack1 = depth0.tabSaved; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  buffer += escapeExpression(stack1)
    + "</span></a>\n        ";
  return buffer;
  }

function program3(depth0,data) {
  
  var buffer = "", stack1;
  buffer += "\n          <span class=\"button is-disabled\" href=\"\" data-tab=\"saved\" tabindex=\"-1\">";
  if (stack1 = helpers.tabSaved) { stack1 = stack1.call(depth0, {hash:{},data:data}); }
  else { stack1 = depth0.tabSaved; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  buffer += escapeExpression(stack1)
    + "</span>\n        ";
  return buffer;
  }

function program5(depth0,data) {
  
  
  return "\n  ";
  }

function program7(depth0,data) {
  
  var buffer = "", stack1;
  buffer += "\n  <div class=\"button-group-cell iconned\">\n    <div class=\"trough\">\n      <a class=\"button js-toggle-guides tooltipped tooltipped-sw\" aria-label=\"";
  if (stack1 = helpers.msgToggleGuideVisibility) { stack1 = stack1.call(depth0, {hash:{},data:data}); }
  else { stack1 = depth0.msgToggleGuideVisibility; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  buffer += escapeExpression(stack1)
    + "\" href=\"\" tabindex=\"-1\">";
  if (stack1 = helpers.iconEye) { stack1 = stack1.call(depth0, {hash:{},data:data}); }
  else { stack1 = depth0.iconEye; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  if(stack1 || stack1 === 0) { buffer += stack1; }
  buffer += "</a>\n    </div>\n  </div>\n  ";
  return buffer;
  }

  buffer += "<div class=\"button-group uneven\">\n\n  <div class=\"button-group-cell auto\">\n    <div class=\"trough\">\n      <div class=\"tab-group\">\n        <a class=\"button is-active\" href=\"\" data-tab=\"form\" tabindex=\"-1\"><span class=\"overflow\">";
  if (stack1 = helpers.tabForm) { stack1 = stack1.call(depth0, {hash:{},data:data}); }
  else { stack1 = depth0.tabForm; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  buffer += escapeExpression(stack1)
    + "</span></a>\n        <a class=\"button\" href=\"\" data-tab=\"custom\" tabindex=\"-1\"><span class=\"overflow\">";
  if (stack1 = helpers.tabCustom) { stack1 = stack1.call(depth0, {hash:{},data:data}); }
  else { stack1 = depth0.tabCustom; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  buffer += escapeExpression(stack1)
    + "</span></a>\n        ";
  stack1 = helpers['if'].call(depth0, depth0.showSavedTab, {hash:{},inverse:self.program(3, program3, data),fn:self.program(1, program1, data),data:data});
  if(stack1 || stack1 === 0) { buffer += stack1; }
  buffer += "\n      </div>\n    </div>\n  </div>\n\n  ";
  stack2 = helpers['if'].call(depth0, ((stack1 = depth0.app),stack1 == null || stack1 === false ? stack1 : stack1.freeVersion), {hash:{},inverse:self.program(7, program7, data),fn:self.program(5, program5, data),data:data});
  if(stack2 || stack2 === 0) { buffer += stack2; }
  buffer += "\n\n</div> <!-- /.button-group -->\n";
  return buffer;
  });
});


define('hbs!templates/icons', ['handlebars'], function(Handlebars){ 
return Handlebars.template(function (Handlebars,depth0,helpers,partials,data) {
  this.compilerInfo = [4,'>= 1.0.0'];
helpers = this.merge(helpers, Handlebars.helpers); data = data || {};
  var buffer = "", stack1, options, functionType="function", escapeExpression=this.escapeExpression, self=this, blockHelperMissing=helpers.blockHelperMissing;

function program1(depth0,data) {
  
  var buffer = "", stack1;
  buffer += "class=\"";
  if (stack1 = helpers.classes) { stack1 = stack1.call(depth0, {hash:{},data:data}); }
  else { stack1 = depth0.classes; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  buffer += escapeExpression(stack1)
    + "\"";
  return buffer;
  }

function program3(depth0,data) {
  
  
  return "\r\n  <g transform=\"translate(4,4)\">\r\n    <path x=\"2\" d=\"M12,6c0,1.7-0.6,3.1-1.8,4.2C9.1,11.4,7.7,12,6,12c-1.7,0-3.1-0.6-4.2-1.8C0.6,9.1,0,7.7,0,6\r\n    c0-1.7,0.6-3.1,1.8-4.2C2.9,0.6,4.3,0,6,0c1.7,0,3.1,0.6,4.2,1.8C11.4,2.9,12,4.3,12,6z M3,3C2.1,3.8,1.7,4.8,1.7,6\r\n    c0,0.8,0.2,1.6,0.7,2.4l5.9-5.9C7.6,2,6.9,1.7,6,1.7C4.8,1.7,3.8,2.1,3,3z M6,10.3c1.2,0,2.2-0.4,3-1.3c0.8-0.8,1.3-1.8,1.3-3\r\n    c0-0.9-0.2-1.7-0.7-2.4L3.6,9.6C4.4,10,5.2,10.3,6,10.3L6,10.3z\"/>\r\n  </g>\r\n  ";
  }

function program5(depth0,data) {
  
  
  return "\r\n  <g transform=\"translate(4,4)\">\r\n    <path fill=\"none\" d=\"M9.7,2c0.5,0.3,0.9,0.6,1.3,1c0.4,0.4,0.7,0.7,0.9,1.1c0.2,0.3,0.4,0.6,0.6,1c0.2,0.3,0.3,0.6,0.4,0.7\r\n    C12.9,5.8,13,5.9,13,6l-0.1,0.3c-0.1,0.2-0.2,0.4-0.4,0.7c-0.2,0.3-0.4,0.6-0.6,1c-0.2,0.4-0.6,0.7-1,1.1c-0.4,0.4-0.8,0.7-1.3,1\r\n    c-0.5,0.3-1,0.5-1.7,0.7C7.4,10.9,6.7,11,6,11s-1.4-0.1-2-0.3c-0.6-0.2-1.2-0.4-1.6-0.7C1.9,9.7,1.4,9.4,1,9C0.6,8.6,0.3,8.3,0.1,8\r\n    c-0.2-0.3-0.4-0.6-0.6-1c-0.2-0.3-0.3-0.6-0.4-0.7C-0.9,6.2-1,6.1-1,6l0.1-0.3C-0.8,5.5-0.7,5.3-0.5,5c0.2-0.3,0.4-0.6,0.6-1\r\n    C0.3,3.7,0.7,3.3,1,3c0.4-0.4,0.8-0.7,1.3-1s1-0.5,1.7-0.7C4.6,1.1,5.3,1,6,1s1.4,0.1,2,0.3S9.2,1.7,9.7,2z M9.5,6\r\n    c0-0.9-0.3-1.7-1-2.4C7.8,3,7,2.7,6,2.7c-1,0-1.8,0.3-2.5,1s-1,1.4-1,2.4c0,0.9,0.3,1.7,1,2.4C4.2,9,5,9.3,6,9.3c1,0,1.8-0.3,2.5-1\r\n    C9.2,7.7,9.5,6.9,9.5,6z M7.2,4.8C7.6,5.1,7.8,5.5,7.8,6c0,0.5-0.2,0.9-0.5,1.2C6.9,7.5,6.5,7.7,6,7.7c-0.5,0-0.9-0.2-1.2-0.5\r\n    C4.4,6.9,4.2,6.5,4.2,6c0-0.2,0-0.3,0.1-0.5C4.5,5.8,4.8,6,5.1,6c0.2,0,0.4-0.1,0.6-0.2C5.9,5.6,6,5.4,6,5.2c0-0.4-0.2-0.6-0.5-0.8\r\n    C5.6,4.4,5.8,4.3,6,4.3C6.5,4.3,6.9,4.5,7.2,4.8z\"/>\r\n  </g>\r\n  ";
  }

function program7(depth0,data) {
  
  var buffer = "", stack1, options;
  buffer += "\r\n  <g transform=\"translate(0,0)";
  options = {hash:{},inverse:self.noop,fn:self.program(8, program8, data),data:data};
  if (stack1 = helpers.rotate) { stack1 = stack1.call(depth0, options); }
  else { stack1 = depth0.rotate; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  if (!helpers.rotate) { stack1 = blockHelperMissing.call(depth0, stack1, options); }
  if(stack1 || stack1 === 0) { buffer += stack1; }
  buffer += "\">\r\n    <path d=\"M14,11h-2v2l-3-3l3-3v2h2V11z M8,3v14H6V3H8z\"/>\r\n  </g>\r\n  ";
  return buffer;
  }
function program8(depth0,data) {
  
  
  return " rotate(90, 10, 10)";
  }

function program10(depth0,data) {
  
  var buffer = "", stack1, options;
  buffer += "\r\n  <g transform=\"translate(0,0)";
  options = {hash:{},inverse:self.noop,fn:self.program(8, program8, data),data:data};
  if (stack1 = helpers.rotate) { stack1 = stack1.call(depth0, options); }
  else { stack1 = depth0.rotate; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  if (!helpers.rotate) { stack1 = blockHelperMissing.call(depth0, stack1, options); }
  if(stack1 || stack1 === 0) { buffer += stack1; }
  buffer += "\">\r\n    <path d=\"M17,11h-2v2l-3-3l3-3v2h2V11z M3,9h2V7l3,3l-3,3v-2H3V9z M11,3v14H9V3H11z\"/>\r\n  </g>\r\n  ";
  return buffer;
  }

function program12(depth0,data) {
  
  var buffer = "", stack1, options;
  buffer += "\r\n  <g transform=\"translate(0,0)";
  options = {hash:{},inverse:self.noop,fn:self.program(8, program8, data),data:data};
  if (stack1 = helpers.rotate) { stack1 = stack1.call(depth0, options); }
  else { stack1 = depth0.rotate; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  if (!helpers.rotate) { stack1 = blockHelperMissing.call(depth0, stack1, options); }
  if(stack1 || stack1 === 0) { buffer += stack1; }
  buffer += "\">\r\n    <path d=\"M6,9h2V7l3,3l-3,3v-2H6V9z M14,3v14h-2V3H14z\"/>\r\n  </g>\r\n  ";
  return buffer;
  }

function program14(depth0,data) {
  
  var buffer = "", stack1, options;
  buffer += "\r\n  <g transform=\"translate(0,0)";
  options = {hash:{},inverse:self.noop,fn:self.program(8, program8, data),data:data};
  if (stack1 = helpers.rotate) { stack1 = stack1.call(depth0, options); }
  else { stack1 = depth0.rotate; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  if (!helpers.rotate) { stack1 = blockHelperMissing.call(depth0, stack1, options); }
  if(stack1 || stack1 === 0) { buffer += stack1; }
  buffer += "\">\r\n    <path d=\"M17,18V2h1v16H17z M14,9h2v2h-2V9z M12,2h1v16h-1V2z M9,9h2v2H9V9z M7,2h1v16H7V2z M4,9h2v2H4V9z M2,2h1v16H2V2z\"/>\r\n  </g>\r\n  ";
  return buffer;
  }

function program16(depth0,data) {
  
  var buffer = "", stack1, options;
  buffer += "\r\n  <g transform=\"translate(0,0)";
  options = {hash:{},inverse:self.noop,fn:self.program(8, program8, data),data:data};
  if (stack1 = helpers.rotate) { stack1 = stack1.call(depth0, options); }
  else { stack1 = depth0.rotate; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  if (!helpers.rotate) { stack1 = blockHelperMissing.call(depth0, stack1, options); }
  if(stack1 || stack1 === 0) { buffer += stack1; }
  buffer += "\">\r\n    <path d=\"M2,18h1V2H2V18z M8,18h1V2H8V18z M17,2v16h1V2H17z M11,18h1V2h-1V18z\"/>\r\n    <path class=\"fade\" d=\"M3,18h5V2H3V18z M12,2v16h5V2H12z\"/>\r\n  </g>\r\n  ";
  return buffer;
  }

function program18(depth0,data) {
  
  var buffer = "", stack1, options;
  buffer += "\r\n  <g transform=\"translate(0,0)";
  options = {hash:{},inverse:self.noop,fn:self.program(8, program8, data),data:data};
  if (stack1 = helpers.rotate) { stack1 = stack1.call(depth0, options); }
  else { stack1 = depth0.rotate; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  if (!helpers.rotate) { stack1 = blockHelperMissing.call(depth0, stack1, options); }
  if(stack1 || stack1 === 0) { buffer += stack1; }
  buffer += "\">\r\n    <path d=\"M2,18h1V2H2V18z M8,18h1V2H8V18z M17,2v16h1V2H17z M11,18h1V2h-1V18z\"/>\r\n    <path class=\"fade\" d=\"M9,2v16h2V2H9z\"/>\r\n  </g>\r\n  ";
  return buffer;
  }

function program20(depth0,data) {
  
  var buffer = "", stack1, options;
  buffer += "\r\n  <g transform=\"translate(0,0)";
  options = {hash:{},inverse:self.noop,fn:self.program(8, program8, data),data:data};
  if (stack1 = helpers.rotate) { stack1 = stack1.call(depth0, options); }
  else { stack1 = depth0.rotate; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  if (!helpers.rotate) { stack1 = blockHelperMissing.call(depth0, stack1, options); }
  if(stack1 || stack1 === 0) { buffer += stack1; }
  buffer += "\">\r\n    <path d=\"M13,7v2h3v2h-3v2l-3-3L13,7z M6,4v12H4V4H6z M10,4v12H8V4H10z\"/>\r\n  </g>\r\n  ";
  return buffer;
  }

function program22(depth0,data) {
  
  var buffer = "", stack1, options;
  buffer += "\r\n  <g transform=\"translate(0,0)";
  options = {hash:{},inverse:self.noop,fn:self.program(8, program8, data),data:data};
  if (stack1 = helpers.rotate) { stack1 = stack1.call(depth0, options); }
  else { stack1 = depth0.rotate; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  if (!helpers.rotate) { stack1 = blockHelperMissing.call(depth0, stack1, options); }
  if(stack1 || stack1 === 0) { buffer += stack1; }
  buffer += "\">\r\n    <path d=\"M7,13v-2H4V9h3V7l3,3L7,13z M14,16V4h2v12H14z M10,16V4h2v12H10z\"/>\r\n  </g>\r\n  ";
  return buffer;
  }

function program24(depth0,data) {
  
  var buffer = "", stack1, options;
  buffer += "\r\n  <g transform=\"translate(4,7)";
  options = {hash:{},inverse:self.noop,fn:self.program(25, program25, data),data:data};
  if (stack1 = helpers.rotate) { stack1 = stack1.call(depth0, options); }
  else { stack1 = depth0.rotate; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  if (!helpers.rotate) { stack1 = blockHelperMissing.call(depth0, stack1, options); }
  if(stack1 || stack1 === 0) { buffer += stack1; }
  buffer += "\">\r\n    <path d=\"M6,0L0,6h12L6,0z\"/>\r\n  </g>\r\n  ";
  return buffer;
  }
function program25(depth0,data) {
  
  
  return " rotate(180, 6, 3)";
  }

function program27(depth0,data) {
  
  
  return "\r\n  <g transform=\"translate(2,7)\">\r\n    <path d=\"M0,3l3,3V0L0,3z\"/>\r\n  </g>\r\n  ";
  }

function program29(depth0,data) {
  
  
  return "\r\n    <g transform=\"translate(1,2)\">\r\n      <path d=\"M0,4l2-2l2,2l4-4l2,2L4,8L0,4z\"/>\r\n    </g>\r\n  ";
  }

function program31(depth0,data) {
  
  var buffer = "", stack1, options;
  buffer += "\r\n    <g transform=\"translate(0,0)";
  options = {hash:{},inverse:self.noop,fn:self.program(8, program8, data),data:data};
  if (stack1 = helpers.rotate) { stack1 = stack1.call(depth0, options); }
  else { stack1 = depth0.rotate; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  if (!helpers.rotate) { stack1 = blockHelperMissing.call(depth0, stack1, options); }
  if(stack1 || stack1 === 0) { buffer += stack1; }
  buffer += "\">\r\n      <path class=\"fade\" d=\"M12,18v-1h5V3h-5V2h6v16H12z M9,2h2v16H9V2z M6,2h2v16H6V2z M3,2h2v16H3V2z\"/>\r\n      <path d=\"M11,18V2h1v16H11z M8,2h1v16H8V2z M5,2h1v16H5V2z M2,2h1v16H2V2z\"/>\r\n    </g>\r\n  ";
  return buffer;
  }

function program33(depth0,data) {
  
  var buffer = "", stack1, options;
  buffer += "\r\n    <g transform=\"translate(0,0)";
  options = {hash:{},inverse:self.noop,fn:self.program(8, program8, data),data:data};
  if (stack1 = helpers.rotate) { stack1 = stack1.call(depth0, options); }
  else { stack1 = depth0.rotate; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  if (!helpers.rotate) { stack1 = blockHelperMissing.call(depth0, stack1, options); }
  if(stack1 || stack1 === 0) { buffer += stack1; }
  buffer += "\">\r\n      <path class=\"fade\" d=\"M15,18v-1h2V3h-2V2h3v16H15z M12,2h2v16h-2V2z M9,2h2v16H9V2z M6,2h2v16H6V2z M2,2 h3v1H3v14h2v1H2V2z\"/>\r\n      <path d=\"M14,18V2h1v16H14z M11,2h1v16h-1V2z M8,2h1v16H8V2z M5,2h1v16H5V2z\"/>\r\n    </g>\r\n  ";
  return buffer;
  }

function program35(depth0,data) {
  
  var buffer = "", stack1, options;
  buffer += "\r\n    <g transform=\"translate(0,0)";
  options = {hash:{},inverse:self.noop,fn:self.program(8, program8, data),data:data};
  if (stack1 = helpers.rotate) { stack1 = stack1.call(depth0, options); }
  else { stack1 = depth0.rotate; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  if (!helpers.rotate) { stack1 = blockHelperMissing.call(depth0, stack1, options); }
  if(stack1 || stack1 === 0) { buffer += stack1; }
  buffer += "\">\r\n      <path class=\"fade\" d=\"M15,2h2v16h-2V2z M12,2h2v16h-2V2z M9,2h2v16H9V2z M2,2h6v1H3v14h5v1H2V2z\"/>\r\n      <path d=\"M17,18V2h1v16H17z M14,2h1v16h-1V2z M11,2h1v16h-1V2z M8,2h1v16H8V2z\"/>\r\n    </g>\r\n  ";
  return buffer;
  }

  buffer += "<svg height=\"20\" width=\"20\"";
  stack1 = helpers['if'].call(depth0, depth0.classes, {hash:{},inverse:self.noop,fn:self.program(1, program1, data),data:data});
  if(stack1 || stack1 === 0) { buffer += stack1; }
  buffer += ">\r\n\r\n  ";
  options = {hash:{},inverse:self.noop,fn:self.program(3, program3, data),data:data};
  if (stack1 = helpers.circleslash) { stack1 = stack1.call(depth0, options); }
  else { stack1 = depth0.circleslash; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  if (!helpers.circleslash) { stack1 = blockHelperMissing.call(depth0, stack1, options); }
  if(stack1 || stack1 === 0) { buffer += stack1; }
  buffer += "\r\n\r\n  ";
  options = {hash:{},inverse:self.noop,fn:self.program(5, program5, data),data:data};
  if (stack1 = helpers.eye) { stack1 = stack1.call(depth0, options); }
  else { stack1 = depth0.eye; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  if (!helpers.eye) { stack1 = blockHelperMissing.call(depth0, stack1, options); }
  if(stack1 || stack1 === 0) { buffer += stack1; }
  buffer += "\r\n\r\n  ";
  options = {hash:{},inverse:self.noop,fn:self.program(7, program7, data),data:data};
  if (stack1 = helpers.first) { stack1 = stack1.call(depth0, options); }
  else { stack1 = depth0.first; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  if (!helpers.first) { stack1 = blockHelperMissing.call(depth0, stack1, options); }
  if(stack1 || stack1 === 0) { buffer += stack1; }
  buffer += "\r\n\r\n  ";
  options = {hash:{},inverse:self.noop,fn:self.program(10, program10, data),data:data};
  if (stack1 = helpers.center) { stack1 = stack1.call(depth0, options); }
  else { stack1 = depth0.center; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  if (!helpers.center) { stack1 = blockHelperMissing.call(depth0, stack1, options); }
  if(stack1 || stack1 === 0) { buffer += stack1; }
  buffer += "\r\n\r\n  ";
  options = {hash:{},inverse:self.noop,fn:self.program(12, program12, data),data:data};
  if (stack1 = helpers.last) { stack1 = stack1.call(depth0, options); }
  else { stack1 = depth0.last; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  if (!helpers.last) { stack1 = blockHelperMissing.call(depth0, stack1, options); }
  if(stack1 || stack1 === 0) { buffer += stack1; }
  buffer += "\r\n\r\n  ";
  options = {hash:{},inverse:self.noop,fn:self.program(14, program14, data),data:data};
  if (stack1 = helpers.count) { stack1 = stack1.call(depth0, options); }
  else { stack1 = depth0.count; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  if (!helpers.count) { stack1 = blockHelperMissing.call(depth0, stack1, options); }
  if(stack1 || stack1 === 0) { buffer += stack1; }
  buffer += "\r\n\r\n  ";
  options = {hash:{},inverse:self.noop,fn:self.program(16, program16, data),data:data};
  if (stack1 = helpers.measure) { stack1 = stack1.call(depth0, options); }
  else { stack1 = depth0.measure; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  if (!helpers.measure) { stack1 = blockHelperMissing.call(depth0, stack1, options); }
  if(stack1 || stack1 === 0) { buffer += stack1; }
  buffer += "\r\n\r\n  ";
  options = {hash:{},inverse:self.noop,fn:self.program(18, program18, data),data:data};
  if (stack1 = helpers.gutter) { stack1 = stack1.call(depth0, options); }
  else { stack1 = depth0.gutter; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  if (!helpers.gutter) { stack1 = blockHelperMissing.call(depth0, stack1, options); }
  if(stack1 || stack1 === 0) { buffer += stack1; }
  buffer += "\r\n\r\n  ";
  options = {hash:{},inverse:self.noop,fn:self.program(20, program20, data),data:data};
  if (stack1 = helpers.firstmargin) { stack1 = stack1.call(depth0, options); }
  else { stack1 = depth0.firstmargin; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  if (!helpers.firstmargin) { stack1 = blockHelperMissing.call(depth0, stack1, options); }
  if(stack1 || stack1 === 0) { buffer += stack1; }
  buffer += "\r\n\r\n  ";
  options = {hash:{},inverse:self.noop,fn:self.program(22, program22, data),data:data};
  if (stack1 = helpers.lastmargin) { stack1 = stack1.call(depth0, options); }
  else { stack1 = depth0.lastmargin; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  if (!helpers.lastmargin) { stack1 = blockHelperMissing.call(depth0, stack1, options); }
  if(stack1 || stack1 === 0) { buffer += stack1; }
  buffer += "\r\n\r\n  ";
  options = {hash:{},inverse:self.noop,fn:self.program(24, program24, data),data:data};
  if (stack1 = helpers.triangle) { stack1 = stack1.call(depth0, options); }
  else { stack1 = depth0.triangle; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  if (!helpers.triangle) { stack1 = blockHelperMissing.call(depth0, stack1, options); }
  if(stack1 || stack1 === 0) { buffer += stack1; }
  buffer += "\r\n\r\n  ";
  options = {hash:{},inverse:self.noop,fn:self.program(27, program27, data),data:data};
  if (stack1 = helpers.smalltriangle) { stack1 = stack1.call(depth0, options); }
  else { stack1 = depth0.smalltriangle; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  if (!helpers.smalltriangle) { stack1 = blockHelperMissing.call(depth0, stack1, options); }
  if(stack1 || stack1 === 0) { buffer += stack1; }
  buffer += "\r\n\r\n  ";
  options = {hash:{},inverse:self.noop,fn:self.program(29, program29, data),data:data};
  if (stack1 = helpers.check) { stack1 = stack1.call(depth0, options); }
  else { stack1 = depth0.check; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  if (!helpers.check) { stack1 = blockHelperMissing.call(depth0, stack1, options); }
  if(stack1 || stack1 === 0) { buffer += stack1; }
  buffer += "\r\n\r\n  ";
  options = {hash:{},inverse:self.noop,fn:self.program(31, program31, data),data:data};
  if (stack1 = helpers.firstposition) { stack1 = stack1.call(depth0, options); }
  else { stack1 = depth0.firstposition; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  if (!helpers.firstposition) { stack1 = blockHelperMissing.call(depth0, stack1, options); }
  if(stack1 || stack1 === 0) { buffer += stack1; }
  buffer += "\r\n\r\n  ";
  options = {hash:{},inverse:self.noop,fn:self.program(33, program33, data),data:data};
  if (stack1 = helpers.centerposition) { stack1 = stack1.call(depth0, options); }
  else { stack1 = depth0.centerposition; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  if (!helpers.centerposition) { stack1 = blockHelperMissing.call(depth0, stack1, options); }
  if(stack1 || stack1 === 0) { buffer += stack1; }
  buffer += "\r\n\r\n  ";
  options = {hash:{},inverse:self.noop,fn:self.program(35, program35, data),data:data};
  if (stack1 = helpers.lastposition) { stack1 = stack1.call(depth0, options); }
  else { stack1 = depth0.lastposition; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  if (!helpers.lastposition) { stack1 = blockHelperMissing.call(depth0, stack1, options); }
  if(stack1 || stack1 === 0) { buffer += stack1; }
  buffer += "\r\n\r\n</svg>\r\n";
  return buffer;
  });
});


(function() {

  define('cs!views/tabs',['cs!view', 'hbs!templates/tabs', 'cs!lib/messages', 'hbs!templates/icons'], function(View, template, Messages, Icons) {
    return View.extend({
      name: 'tabs',
      template: template,
      iconEye: Icons({
        eye: true
      }),
      events: {
        'click [data-tab]': 'onTabClick',
        'click .js-toggle-guides': 'onClickToggleGuides'
      },
      initialize: function() {
        var _ref;
        this.tabForm = Messages.get("tabForm");
        this.tabCustom = Messages.get("tabCustom");
        this.tabSaved = Messages.get("tabSaved");
        this.msgToggleGuideVisibility = Messages.get('tooltipToggleGuideVisibility');
        return this.showSavedTab = ((_ref = this.app) != null ? _ref.localStorage : void 0) != null ? this.app.localStorage : false;
      },
      onTabClick: function(event) {
        var $tab;
        event.preventDefault();
        $tab = $(event.currentTarget);
        if ($tab.hasClass('is-disabled')) {
          return;
        }
        this.$('[data-tab]').removeClass('is-active');
        $tab.addClass('is-active');
        return this.trigger('tab:click', $(event.currentTarget).attr('data-tab'));
      },
      onClickToggleGuides: function(event) {
        event.preventDefault();
        $(event.currentTarget).blur();
        this.trigger('toggleGuides');
        return typeof ga === "function" ? ga('event', 'Utilities', 'Toggle visibility') : void 0;
      },
      toggleTitle: function(toggle) {
        return this.$el.toggleClass('is-hidden', toggle);
      }
    });
  });

}).call(this);


define('hbs!templates/alert', ['handlebars'], function(Handlebars){ 
return Handlebars.template(function (Handlebars,depth0,helpers,partials,data) {
  this.compilerInfo = [4,'>= 1.0.0'];
helpers = this.merge(helpers, Handlebars.helpers); data = data || {};
  var buffer = "", stack1, options, functionType="function", escapeExpression=this.escapeExpression, helperMissing=helpers.helperMissing;


  buffer += "<div class=\"alert-wrap\">\n  <div class=\"header\">\n    <div class=\"header-wrapper\">\n      <h3 class=\"js-alert-title\"><div class=\"overflow\">";
  if (stack1 = helpers.title) { stack1 = stack1.call(depth0, {hash:{},data:data}); }
  else { stack1 = depth0.title; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  buffer += escapeExpression(stack1)
    + "</div></h3>\n    </div>\n  </div>\n\n  <hr />\n\n  <div class=\"message js-alert-message\">";
  if (stack1 = helpers.message) { stack1 = stack1.call(depth0, {hash:{},data:data}); }
  else { stack1 = depth0.message; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  buffer += escapeExpression(stack1)
    + "</div>\n\n  <div class=\"footer\">\n\n    <hr />\n\n    <div class=\"footer-wrapper\">\n\n      <div class=\"button-group\">\n\n        ";
  options = {hash:{},data:data};
  buffer += escapeExpression(((stack1 = helpers.view || depth0.view),stack1 ? stack1.call(depth0, depth0.footer, options) : helperMissing.call(depth0, "view", depth0.footer, options)))
    + "\n\n      </div>\n\n    </div><!-- /.footer-wrapper -->\n  </div><!-- /.footer -->\n</div>\n\n<div class=\"alert-backplate\"></div>\n";
  return buffer;
  });
});


(function() {
  var __hasProp = {}.hasOwnProperty,
    __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; };

  define('cs!model',['thorax'], function(Thorax) {
    var Model;
    return Model = (function(_super) {

      __extends(Model, _super);

      function Model() {
        return Model.__super__.constructor.apply(this, arguments);
      }

      return Model;

    })(Thorax.Model);
  });

}).call(this);


(function() {

  define('cs!models/alert',['cs!model'], function(Model) {
    return Model.extend({
      name: 'alert',
      defaults: {
        title: '',
        message: ''
      }
    });
  });

}).call(this);


define('hbs!templates/footer', ['handlebars'], function(Handlebars){ 
return Handlebars.template(function (Handlebars,depth0,helpers,partials,data) {
  this.compilerInfo = [4,'>= 1.0.0'];
helpers = this.merge(helpers, Handlebars.helpers); data = data || {};
  var buffer = "", stack1, stack2, options, functionType="function", escapeExpression=this.escapeExpression, self=this, helperMissing=helpers.helperMissing;

function program1(depth0,data) {
  
  var buffer = "", stack1;
  buffer += "\n      <div class=\"button-group-cell\">\n        <div class=\"trough\">\n          <a class=\"button js-button ";
  if (stack1 = helpers.classes) { stack1 = stack1.call(depth0, {hash:{},data:data}); }
  else { stack1 = depth0.classes; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  buffer += escapeExpression(stack1)
    + "\" data-name=\"";
  if (stack1 = helpers.name) { stack1 = stack1.call(depth0, {hash:{},data:data}); }
  else { stack1 = depth0.name; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  buffer += escapeExpression(stack1)
    + "\" href=\"\" tabindex=\"-1\"><span class=\"overflow\">";
  if (stack1 = helpers.label) { stack1 = stack1.call(depth0, {hash:{},data:data}); }
  else { stack1 = depth0.label; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  buffer += escapeExpression(stack1)
    + "</span></a>\n        </div>\n      </div>\n      ";
  return buffer;
  }

function program3(depth0,data) {
  
  var buffer = "", stack1;
  buffer += "\n      <div class=\"button-group-cell\">\n        <div class=\"trough\">\n          <a class=\"button js-button default\" data-name=\"ok\" href=\"\" tabindex=\"-1\"><span class=\"overflow\">";
  if (stack1 = helpers.msgOk) { stack1 = stack1.call(depth0, {hash:{},data:data}); }
  else { stack1 = depth0.msgOk; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  buffer += escapeExpression(stack1)
    + "</span></a>\n        </div>\n      </div>\n      ";
  return buffer;
  }

function program5(depth0,data) {
  
  var buffer = "", stack1;
  buffer += "\n      <div class=\"button-group-cell iconned\">\n        <div class=\"trough\">\n          <a class=\"button js-more up-triangle\" href=\"\" tabindex=\"-1\">";
  if (stack1 = helpers.iconUpTriangle) { stack1 = stack1.call(depth0, {hash:{},data:data}); }
  else { stack1 = depth0.iconUpTriangle; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  if(stack1 || stack1 === 0) { buffer += stack1; }
  buffer += "</a>\n          <a class=\"button js-more down-triangle\" href=\"\" tabindex=\"-1\">";
  if (stack1 = helpers.iconDownTriangle) { stack1 = stack1.call(depth0, {hash:{},data:data}); }
  else { stack1 = depth0.iconDownTriangle; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  if(stack1 || stack1 === 0) { buffer += stack1; }
  buffer += "</a>\n        </div>\n      </div>\n      ";
  return buffer;
  }

function program7(depth0,data) {
  
  var buffer = "", stack1, stack2, options;
  buffer += "\n  <hr />\n\n  <div class=\"side-padding more-buttons\">\n\n    ";
  options = {hash:{},inverse:self.noop,fn:self.program(8, program8, data),data:data};
  stack2 = ((stack1 = helpers.collection || depth0.collection),stack1 ? stack1.call(depth0, depth0.more, options) : helperMissing.call(depth0, "collection", depth0.more, options));
  if(stack2 || stack2 === 0) { buffer += stack2; }
  buffer += "\n\n  </div><!-- /.side-padding -->\n  ";
  return buffer;
  }
function program8(depth0,data) {
  
  var buffer = "", stack1;
  buffer += "\n      <div class=\"trough\">\n        <a class=\"button block js-button ";
  if (stack1 = helpers.classes) { stack1 = stack1.call(depth0, {hash:{},data:data}); }
  else { stack1 = depth0.classes; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  buffer += escapeExpression(stack1)
    + "\" data-name=\"";
  if (stack1 = helpers.name) { stack1 = stack1.call(depth0, {hash:{},data:data}); }
  else { stack1 = depth0.name; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  buffer += escapeExpression(stack1)
    + "\" href=\"\" tabindex=\"-1\">";
  if (stack1 = helpers.label) { stack1 = stack1.call(depth0, {hash:{},data:data}); }
  else { stack1 = depth0.label; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  buffer += escapeExpression(stack1)
    + "</a>\n      </div>\n    ";
  return buffer;
  }

function program10(depth0,data) {
  
  var buffer = "", stack1, stack2;
  buffer += "\n<div class=\"quick-guides above-backplate\">\n  <div class=\"side-padding\">\n    <div class=\"button-group\">\n      ";
  stack2 = helpers['if'].call(depth0, ((stack1 = depth0.app),stack1 == null || stack1 === false ? stack1 : stack1.freeVersion), {hash:{},inverse:self.program(13, program13, data),fn:self.program(11, program11, data),data:data});
  if(stack2 || stack2 === 0) { buffer += stack2; }
  buffer += "\n    </div> <!-- /.button-group -->\n  </div>\n</div>\n";
  return buffer;
  }
function program11(depth0,data) {
  
  var buffer = "", stack1;
  buffer += "\n        <div class=\"upsell\">";
  if (stack1 = helpers.msgUpsell) { stack1 = stack1.call(depth0, {hash:{},data:data}); }
  else { stack1 = depth0.msgUpsell; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  buffer += escapeExpression(stack1)
    + "</div>\n      ";
  return buffer;
  }

function program13(depth0,data) {
  
  var buffer = "", stack1;
  buffer += "\n        <div class=\"button-group-cell\">\n          <a class=\"button js-button tooltipped tooltipped-ne\" aria-label=\"";
  if (stack1 = helpers.msgLeftBorder) { stack1 = stack1.call(depth0, {hash:{},data:data}); }
  else { stack1 = depth0.msgLeftBorder; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  buffer += escapeExpression(stack1)
    + "\" data-name=\"quickVFirst\" href=\"\" tabindex=\"-1\">";
  if (stack1 = helpers.iconQuickVFirst) { stack1 = stack1.call(depth0, {hash:{},data:data}); }
  else { stack1 = depth0.iconQuickVFirst; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  if(stack1 || stack1 === 0) { buffer += stack1; }
  buffer += "</a>\n        </div>\n        <div class=\"button-group-cell\">\n          <a class=\"button js-button tooltipped tooltipped-ne\" aria-label=\"";
  if (stack1 = helpers.msgMidpoint) { stack1 = stack1.call(depth0, {hash:{},data:data}); }
  else { stack1 = depth0.msgMidpoint; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  buffer += escapeExpression(stack1)
    + "\" data-name=\"quickVCenter\" href=\"\" tabindex=\"-1\">";
  if (stack1 = helpers.iconQuickVCenter) { stack1 = stack1.call(depth0, {hash:{},data:data}); }
  else { stack1 = depth0.iconQuickVCenter; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  if(stack1 || stack1 === 0) { buffer += stack1; }
  buffer += "</a>\n        </div>\n        <div class=\"button-group-cell\">\n          <a class=\"button js-button tooltipped tooltipped-ne\" aria-label=\"";
  if (stack1 = helpers.msgRightBorder) { stack1 = stack1.call(depth0, {hash:{},data:data}); }
  else { stack1 = depth0.msgRightBorder; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  buffer += escapeExpression(stack1)
    + "\" data-name=\"quickVLast\" href=\"\" tabindex=\"-1\">";
  if (stack1 = helpers.iconQuickVLast) { stack1 = stack1.call(depth0, {hash:{},data:data}); }
  else { stack1 = depth0.iconQuickVLast; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  if(stack1 || stack1 === 0) { buffer += stack1; }
  buffer += "</a>\n        </div>\n        <div class=\"button-group-cell\">\n          <a class=\"button js-button tooltipped tooltipped-ne\" aria-label=\"";
  if (stack1 = helpers.msgClearGuides) { stack1 = stack1.call(depth0, {hash:{},data:data}); }
  else { stack1 = depth0.msgClearGuides; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  buffer += escapeExpression(stack1)
    + "\" data-name=\"quickClear\" href=\"\" tabindex=\"-1\">";
  if (stack1 = helpers.iconCircleSlash) { stack1 = stack1.call(depth0, {hash:{},data:data}); }
  else { stack1 = depth0.iconCircleSlash; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  if(stack1 || stack1 === 0) { buffer += stack1; }
  buffer += "</a>\n        </div>\n        <div class=\"button-group-cell\">\n          <a class=\"button js-button tooltipped tooltipped-nw\" aria-label=\"";
  if (stack1 = helpers.msgTopBorder) { stack1 = stack1.call(depth0, {hash:{},data:data}); }
  else { stack1 = depth0.msgTopBorder; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  buffer += escapeExpression(stack1)
    + "\" data-name=\"quickHFirst\" href=\"\" tabindex=\"-1\">";
  if (stack1 = helpers.iconQuickHFirst) { stack1 = stack1.call(depth0, {hash:{},data:data}); }
  else { stack1 = depth0.iconQuickHFirst; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  if(stack1 || stack1 === 0) { buffer += stack1; }
  buffer += "</a>\n        </div>\n        <div class=\"button-group-cell\">\n          <a class=\"button js-button tooltipped tooltipped-nw\" aria-label=\"";
  if (stack1 = helpers.msgMidpoint) { stack1 = stack1.call(depth0, {hash:{},data:data}); }
  else { stack1 = depth0.msgMidpoint; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  buffer += escapeExpression(stack1)
    + "\" data-name=\"quickHCenter\" href=\"\" tabindex=\"-1\">";
  if (stack1 = helpers.iconQuickHCenter) { stack1 = stack1.call(depth0, {hash:{},data:data}); }
  else { stack1 = depth0.iconQuickHCenter; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  if(stack1 || stack1 === 0) { buffer += stack1; }
  buffer += "</a>\n        </div>\n        <div class=\"button-group-cell\">\n          <a class=\"button js-button tooltipped tooltipped-nw\" aria-label=\"";
  if (stack1 = helpers.msgBottomBorder) { stack1 = stack1.call(depth0, {hash:{},data:data}); }
  else { stack1 = depth0.msgBottomBorder; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  buffer += escapeExpression(stack1)
    + "\" data-name=\"quickHLast\" href=\"\" tabindex=\"-1\">";
  if (stack1 = helpers.iconQuickHLast) { stack1 = stack1.call(depth0, {hash:{},data:data}); }
  else { stack1 = depth0.iconQuickHLast; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  if(stack1 || stack1 === 0) { buffer += stack1; }
  buffer += "</a>\n        </div>\n      ";
  return buffer;
  }

  buffer += "<div class=\"actions above-backplate\">\n  <hr />\n\n  <div class=\"side-padding\">\n\n    <div class=\"button-group\">\n\n      ";
  options = {hash:{
    'className': ("footer-button-collection")
  },inverse:self.program(3, program3, data),fn:self.program(1, program1, data),data:data};
  stack2 = ((stack1 = helpers.collection || depth0.collection),stack1 ? stack1.call(depth0, options) : helperMissing.call(depth0, "collection", options));
  if(stack2 || stack2 === 0) { buffer += stack2; }
  buffer += "\n\n      ";
  stack2 = helpers['if'].call(depth0, ((stack1 = depth0.more),stack1 == null || stack1 === false ? stack1 : stack1.length), {hash:{},inverse:self.noop,fn:self.program(5, program5, data),data:data});
  if(stack2 || stack2 === 0) { buffer += stack2; }
  buffer += "\n\n    </div>\n\n  </div><!-- /.side-padding -->\n\n\n  ";
  stack2 = helpers['if'].call(depth0, ((stack1 = depth0.more),stack1 == null || stack1 === false ? stack1 : stack1.length), {hash:{},inverse:self.noop,fn:self.program(7, program7, data),data:data});
  if(stack2 || stack2 === 0) { buffer += stack2; }
  buffer += "\n</div>\n\n\n";
  stack2 = helpers['if'].call(depth0, depth0.quickGuides, {hash:{},inverse:self.noop,fn:self.program(10, program10, data),data:data});
  if(stack2 || stack2 === 0) { buffer += stack2; }
  buffer += "\n\n<div class=\"backplate js-button\" data-name=\"backplate\"></div>\n";
  return buffer;
  });
});


(function() {

  define('cs!views/footer',['cs!view', 'hbs!templates/footer', 'cs!lib/messages', 'hbs!templates/icons'], function(View, template, Messages, Icons) {
    return View.extend({
      name: 'footer',
      template: template,
      className: 'footer',
      iconUpTriangle: Icons({
        triangle: true
      }),
      iconDownTriangle: Icons({
        triangle: true,
        rotate: true
      }),
      iconQuickVFirst: Icons({
        first: true
      }),
      iconQuickVCenter: Icons({
        center: true
      }),
      iconQuickVLast: Icons({
        last: true
      }),
      iconQuickHFirst: Icons({
        rotate: true,
        first: true
      }),
      iconQuickHCenter: Icons({
        rotate: true,
        center: true
      }),
      iconQuickHLast: Icons({
        rotate: true,
        last: true
      }),
      iconCircleSlash: Icons({
        circleslash: true
      }),
      events: {
        'click .js-button': 'onClick',
        'click .js-more': 'onClickMore'
      },
      initialize: function(attributes, options) {
        if (attributes == null) {
          attributes = {};
        }
        if (options == null) {
          options = {};
        }
        this.msgOk = Messages.get("btnOk");
        this.msgClearGuides = Messages.get('tooltipClearGuides');
        this.msgLeftBorder = Messages.get('tooltipLeftBorder');
        this.msgRightBorder = Messages.get('tooltipRightBorder');
        this.msgTopBorder = Messages.get('tooltipTopBorder');
        this.msgBottomBorder = Messages.get('tooltipBottomBorder');
        this.msgMidpoint = Messages.get('tooltipMidpoint');
        this.msgUpsell = Messages.get('msgQuickUpsell');
        this.collection = new Thorax.Collection();
        this.more = new Thorax.Collection();
        if (attributes.buttons != null) {
          return this.replaceButtons(attributes.buttons);
        }
      },
      onClick: function(event) {
        var name;
        event.preventDefault();
        $(event.currentTarget).blur();
        if ($(event.currentTarget).hasClass('is-disabled')) {
          return;
        }
        name = $(event.currentTarget).attr('data-name');
        this.$el.removeClass('is-showing-more');
        return this.trigger('buttonClick', name);
      },
      onClickMore: function(event) {
        event.preventDefault();
        return this.$el.toggleClass('is-showing-more');
      },
      replaceButtons: function(targets) {
        var k, v;
        for (k in targets) {
          v = targets[k];
          this[k].reset(v);
        }
        return this.render();
      },
      toggleButton: function(name, toggle) {
        return this.$(".js-button[data-name=" + name + "]").toggleClass('is-disabled', toggle);
      }
    });
  });

}).call(this);


(function() {

  define('cs!views/alert',['cs!view', 'hbs!templates/alert', 'cs!lib/messages', 'cs!models/alert', 'cs!views/footer'], function(View, template, Messages, Alert, FooterView) {
    return View.extend({
      name: 'alert',
      template: template,
      className: 'alert',
      title: '',
      message: '',
      msgOk: Messages.get("btnOk"),
      events: {
        'alert:reset': 'hide'
      },
      isActive: false,
      queue: [],
      initialize: function(attributes, options) {
        if (attributes == null) {
          attributes = {};
        }
        if (options == null) {
          options = {};
        }
        this.footer = new FooterView();
        this.model = new Alert();
        if (attributes.buttons != null) {
          this.footer.replaceButtons({
            collection: attributes.buttons
          });
        }
        return this.listenTo(this.footer, 'buttonClick', this.onAlertButtonClick);
      },
      onAlertButtonClick: function(buttonID) {
        this.trigger('alert:reset');
        return this.trigger("buttonClick", buttonID);
      },
      hide: function() {
        this.isActive = false;
        this.$el.removeClass('is-active');
        this.model.set(this.model.defaults);
        return this.set();
      },
      show: function() {
        return this.$el.addClass('is-active');
      },
      push: function(obj) {
        this.queue.push(obj);
        return this.set();
      },
      set: function() {
        var obj;
        if (!(this.queue.length > 0)) {
          return;
        }
        if (this.isActive) {
          return;
        }
        this.isActive = true;
        obj = this.queue[0];
        this.model.set({
          title: obj.title,
          message: obj.message
        });
        if (obj.buttons != null) {
          this.footer.replaceButtons({
            collection: obj.buttons
          });
        }
        this.queue.shift();
        return this.show();
      }
    });
  });

}).call(this);


define('hbs!templates/porter', ['handlebars'], function(Handlebars){ 
return Handlebars.template(function (Handlebars,depth0,helpers,partials,data) {
  this.compilerInfo = [4,'>= 1.0.0'];
helpers = this.merge(helpers, Handlebars.helpers); data = data || {};
  var buffer = "", stack1, stack2, options, functionType="function", escapeExpression=this.escapeExpression, helperMissing=helpers.helperMissing, self=this;

function program1(depth0,data) {
  
  var buffer = "", stack1;
  buffer += "\n  <div class=\"cell\">\n    <a class=\"button block js-import-file\" href=\"\"><span class=\"overflow\">";
  if (stack1 = helpers.msgFromAFile) { stack1 = stack1.call(depth0, {hash:{},data:data}); }
  else { stack1 = depth0.msgFromAFile; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  buffer += escapeExpression(stack1)
    + "</span></a>\n  </div>\n  ";
  return buffer;
  }

function program3(depth0,data) {
  
  var buffer = "", stack1;
  buffer += "\n  <div class=\"cell\">\n    <a class=\"button block js-export-file\" href=\"\"><span class=\"overflow\">";
  if (stack1 = helpers.msgToAFile) { stack1 = stack1.call(depth0, {hash:{},data:data}); }
  else { stack1 = depth0.msgToAFile; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  buffer += escapeExpression(stack1)
    + "</span></a>\n  </div>\n  ";
  return buffer;
  }

  buffer += "<div class=\"js-errors\"></div>\n\n<script type=\"text/template\" class=\"js-error-template\">\n  <div class=\"error\">\n    <span class=\"message\"><%= error %></span>\n  </div>\n</script>\n\n<div class=\"import\">\n\n  <h3><span class=\"overflow\">";
  if (stack1 = helpers.msgImportGrids) { stack1 = stack1.call(depth0, {hash:{},data:data}); }
  else { stack1 = depth0.msgImportGrids; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  buffer += escapeExpression(stack1)
    + "</span></h3>\n\n  <hr />\n\n  <div class=\"cell\">\n    ";
  options = {hash:{},data:data};
  buffer += escapeExpression(((stack1 = helpers.view || depth0.view),stack1 ? stack1.call(depth0, depth0.gistInput, options) : helperMissing.call(depth0, "view", depth0.gistInput, options)))
    + "\n  </div>\n\n  <div class=\"cell\">\n    <a class=\"button block js-import-gist\" href=\"\"><span class=\"overflow\">";
  if (stack2 = helpers.msgFromAGitHubGist) { stack2 = stack2.call(depth0, {hash:{},data:data}); }
  else { stack2 = depth0.msgFromAGitHubGist; stack2 = typeof stack2 === functionType ? stack2.apply(depth0) : stack2; }
  buffer += escapeExpression(stack2)
    + "</span></a>\n  </div>\n  ";
  stack2 = helpers['if'].call(depth0, depth0.fsEnabled, {hash:{},inverse:self.noop,fn:self.program(1, program1, data),data:data});
  if(stack2 || stack2 === 0) { buffer += stack2; }
  buffer += "\n\n</div>\n\n<div class=\"export\">\n\n  <h3><span class=\"overflow\">";
  if (stack2 = helpers.msgExportGrids) { stack2 = stack2.call(depth0, {hash:{},data:data}); }
  else { stack2 = depth0.msgExportGrids; stack2 = typeof stack2 === functionType ? stack2.apply(depth0) : stack2; }
  buffer += escapeExpression(stack2)
    + "</span></h3>\n\n  <hr />\n\n  <div class=\"cell\">\n    <a class=\"button block js-export-gist\" href=\"\"><span class=\"overflow\">";
  if (stack2 = helpers.msgToAGitHubGist) { stack2 = stack2.call(depth0, {hash:{},data:data}); }
  else { stack2 = depth0.msgToAGitHubGist; stack2 = typeof stack2 === functionType ? stack2.apply(depth0) : stack2; }
  buffer += escapeExpression(stack2)
    + "</span></a>\n  </div>\n  ";
  stack2 = helpers['if'].call(depth0, depth0.fsEnabled, {hash:{},inverse:self.noop,fn:self.program(3, program3, data),data:data});
  if(stack2 || stack2 === 0) { buffer += stack2; }
  buffer += "\n\n</div>\n\n<hr />\n\n<div class=\"cell\">\n  <a class=\"button block js-cancel\" href=\"\"><span class=\"overflow\">";
  if (stack2 = helpers.msgCancel) { stack2 = stack2.call(depth0, {hash:{},data:data}); }
  else { stack2 = depth0.msgCancel; stack2 = typeof stack2 === functionType ? stack2.apply(depth0) : stack2; }
  buffer += escapeExpression(stack2)
    + "</span></a>\n</div>\n";
  return buffer;
  });
});


define('hbs!templates/text-input', ['handlebars'], function(Handlebars){ 
return Handlebars.template(function (Handlebars,depth0,helpers,partials,data) {
  this.compilerInfo = [4,'>= 1.0.0'];
helpers = this.merge(helpers, Handlebars.helpers); data = data || {};
  var buffer = "", stack1, functionType="function", escapeExpression=this.escapeExpression;


  buffer += "<div class=\"trough\">\n  <div class=\"input-padding\">\n    <input type=\"text\" id=\"";
  if (stack1 = helpers.formName) { stack1 = stack1.call(depth0, {hash:{},data:data}); }
  else { stack1 = depth0.formName; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  buffer += escapeExpression(stack1)
    + "\" name=\"";
  if (stack1 = helpers.formName) { stack1 = stack1.call(depth0, {hash:{},data:data}); }
  else { stack1 = depth0.formName; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  buffer += escapeExpression(stack1)
    + "\" value=\"\" placeholder=\"";
  if (stack1 = helpers.placeholder) { stack1 = stack1.call(depth0, {hash:{},data:data}); }
  else { stack1 = depth0.placeholder; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  buffer += escapeExpression(stack1)
    + "\">\n  </div>\n</div>\n";
  return buffer;
  });
});


(function() {

  define('cs!views/text-input',['cs!view', 'hbs!templates/text-input'], function(View, template) {
    return View.extend({
      name: 'text-input',
      template: template,
      className: 'text-input',
      events: {
        'focus input': 'onFocusInput',
        'blur input': 'onBlurInput',
        'keyup input': 'onKeyup'
      },
      initialize: function() {
        if (this.extraClasses) {
          this.$el.addClass(this.extraClasses);
        }
        return this.formName || (this.formName = "" + this.name + "-" + this.cid);
      },
      onFocusInput: function(event) {
        return this.$el.addClass('is-focused').removeClass('is-invalid');
      },
      onBlurInput: function(event) {
        this.$el.removeClass('is-focused');
        if (this.validate != null) {
          return this.$el.toggleClass('is-invalid', this.validate(this.val()) == null);
        }
      },
      onKeyup: function(event) {
        if (event.which !== 13) {
          return;
        }
        this.$('input').blur();
        if (this.parent) {
          return this.parent.trigger('enterPressed');
        }
      },
      val: function(str) {
        if (str != null) {
          this.$('input').val(str);
        }
        return this.$('input').val();
      }
    });
  });

}).call(this);


(function() {

  define('cs!views/porter',['cs!view', 'hbs!templates/porter', 'cs!lib/messages', 'cs!views/text-input'], function(View, template, Messages, TextInputView) {
    return View.extend({
      name: 'porter',
      template: template,
      className: 'porter',
      events: function() {
        return {
          'click .js-cancel': 'onClickCancel',
          'click .js-import-gist': 'onClickImportGist',
          'click .js-import-file': 'onClickImportFile',
          'click .js-export-gist': 'onClickExportGist',
          'click .js-export-file': 'onClickExportFile'
        };
      },
      initialize: function(attributes, options) {
        var _this = this;
        if (attributes == null) {
          attributes = {};
        }
        if (options == null) {
          options = {};
        }
        this.msgImportGrids = Messages.get('titleImportGrids');
        this.msgExportGrids = Messages.get('titleExportGrids');
        this.msgFromAFile = Messages.get('btnFromAFile');
        this.msgFromAGitHubGist = Messages.get('btnFromAGitHubGist');
        this.msgToAFile = Messages.get('btnToAFile');
        this.msgToAGitHubGist = Messages.get('btnToAGitHubGist');
        this.msgGitHubGistURL = Messages.get('inputGitHubGistURL');
        this.msgCancel = Messages.get('btnCancel');
        this.fsEnabled = this.app.fsEnabled;
        return this.gistInput = new TextInputView({
          placeholder: this.msgGitHubGistURL,
          extraClasses: 'js-gist-url',
          formName: 'porter',
          validate: function(val) {
            return _this.validateGistUrl(val);
          }
        });
      },
      show: function(tab) {
        return this.$el.addClass("is-showing-" + tab);
      },
      hide: function() {
        return this.$el.removeClass('is-showing-import is-showing-export');
      },
      error: function(msg) {
        var $error,
          _this = this;
        $error = $($.trim(_.template(this.$('.js-error-template').html())({
          error: msg
        })));
        this.$('.js-errors').append($error);
        return setTimeout(function() {
          $error.addClass('is-showing');
          return setTimeout(function() {
            $error.removeClass('is-showing');
            return setTimeout(function() {
              return $error.remove();
            }, 1000);
          }, 2000);
        }, 100);
      },
      onClickCancel: function(event) {
        event.preventDefault();
        return this.hide();
      },
      onClickImportGist: function(event) {
        var gist;
        event.preventDefault();
        if (!(gist = this.validateGistUrl(this.gistInput.val()))) {
          return;
        }
        return this.trigger('import:gist', gist);
      },
      onClickImportFile: function(event) {
        event.preventDefault();
        return this.trigger('import:file');
      },
      onClickExportGist: function(event) {
        event.preventDefault();
        return this.trigger('export:gist');
      },
      onClickExportFile: function(event) {
        event.preventDefault();
        return this.trigger('export:file');
      },
      validateGistUrl: function(str) {
        var gistID, gistIDRegexp, gistURL, gistURLRegexp, _ref, _ref1;
        if (str == null) {
          return null;
        }
        gistURLRegexp = /^(https?:\/\/)?gist\.github\.com\/([a-z0-9]+\/)?([a-z0-9]{20})$/i;
        gistURL = (_ref = gistURLRegexp.exec(str)) != null ? _ref[3] : void 0;
        if (gistURL != null) {
          return gistURL;
        }
        gistIDRegexp = /^[a-z0-9]{20}$/i;
        gistID = (_ref1 = gistIDRegexp.exec(str)) != null ? _ref1[0] : void 0;
        return gistID || null;
      }
    });
  });

}).call(this);


define('hbs!templates/form', ['handlebars'], function(Handlebars){ 
return Handlebars.template(function (Handlebars,depth0,helpers,partials,data) {
  this.compilerInfo = [4,'>= 1.0.0'];
helpers = this.merge(helpers, Handlebars.helpers); data = data || {};
  var buffer = "", stack1, options, helperMissing=helpers.helperMissing, escapeExpression=this.escapeExpression;


  buffer += "<form>\n";
  options = {hash:{},data:data};
  buffer += escapeExpression(((stack1 = helpers.view || depth0.view),stack1 ? stack1.call(depth0, depth0.gridName, options) : helperMissing.call(depth0, "view", depth0.gridName, options)))
    + "\n\n<table class=\"fields\">\n  <tr>\n    <td>\n      <div class=\"cell-padding\">\n        ";
  options = {hash:{},data:data};
  buffer += escapeExpression(((stack1 = helpers.view || depth0.view),stack1 ? stack1.call(depth0, depth0.fieldLeftMargin, options) : helperMissing.call(depth0, "view", depth0.fieldLeftMargin, options)))
    + "\n      </div> <!-- /.cell-padding -->\n    </td>\n    <td>\n      <div class=\"cell-padding\">\n        ";
  options = {hash:{},data:data};
  buffer += escapeExpression(((stack1 = helpers.view || depth0.view),stack1 ? stack1.call(depth0, depth0.fieldTopMargin, options) : helperMissing.call(depth0, "view", depth0.fieldTopMargin, options)))
    + "\n      </div> <!-- /.cell-padding -->\n    </td>\n  </tr>\n\n  <tr>\n    <td>\n      <div class=\"cell-padding\">\n        ";
  options = {hash:{},data:data};
  buffer += escapeExpression(((stack1 = helpers.view || depth0.view),stack1 ? stack1.call(depth0, depth0.fieldRightMargin, options) : helperMissing.call(depth0, "view", depth0.fieldRightMargin, options)))
    + "\n      </div> <!-- /.cell-padding -->\n    </td>\n    <td>\n      <div class=\"cell-padding\">\n        ";
  options = {hash:{},data:data};
  buffer += escapeExpression(((stack1 = helpers.view || depth0.view),stack1 ? stack1.call(depth0, depth0.fieldBottomMargin, options) : helperMissing.call(depth0, "view", depth0.fieldBottomMargin, options)))
    + "\n      </div> <!-- /.cell-padding -->\n    </td>\n  </tr>\n\n  <tr>\n    <td>\n      <div class=\"cell-padding\">\n        ";
  options = {hash:{},data:data};
  buffer += escapeExpression(((stack1 = helpers.view || depth0.view),stack1 ? stack1.call(depth0, depth0.fieldColumnCount, options) : helperMissing.call(depth0, "view", depth0.fieldColumnCount, options)))
    + "\n      </div> <!-- /.cell-padding -->\n    </td>\n    <td>\n      <div class=\"cell-padding\">\n        ";
  options = {hash:{},data:data};
  buffer += escapeExpression(((stack1 = helpers.view || depth0.view),stack1 ? stack1.call(depth0, depth0.fieldRowCount, options) : helperMissing.call(depth0, "view", depth0.fieldRowCount, options)))
    + "\n      </div> <!-- /.cell-padding -->\n    </td>\n  </tr>\n\n  <tr>\n    <td>\n      <div class=\"cell-padding\">\n        ";
  options = {hash:{},data:data};
  buffer += escapeExpression(((stack1 = helpers.view || depth0.view),stack1 ? stack1.call(depth0, depth0.fieldColumnWidth, options) : helperMissing.call(depth0, "view", depth0.fieldColumnWidth, options)))
    + "\n      </div> <!-- /.cell-padding -->\n    </td>\n    <td>\n      <div class=\"cell-padding\">\n        ";
  options = {hash:{},data:data};
  buffer += escapeExpression(((stack1 = helpers.view || depth0.view),stack1 ? stack1.call(depth0, depth0.fieldRowHeight, options) : helperMissing.call(depth0, "view", depth0.fieldRowHeight, options)))
    + "\n      </div> <!-- /.cell-padding -->\n    </td>\n  </tr>\n\n  <tr>\n    <td>\n      <div class=\"cell-padding\">\n        ";
  options = {hash:{},data:data};
  buffer += escapeExpression(((stack1 = helpers.view || depth0.view),stack1 ? stack1.call(depth0, depth0.fieldColumnGutter, options) : helperMissing.call(depth0, "view", depth0.fieldColumnGutter, options)))
    + "\n      </div> <!-- /.cell-padding -->\n    </td>\n    <td>\n      <div class=\"cell-padding\">\n        ";
  options = {hash:{},data:data};
  buffer += escapeExpression(((stack1 = helpers.view || depth0.view),stack1 ? stack1.call(depth0, depth0.fieldRowGutter, options) : helperMissing.call(depth0, "view", depth0.fieldRowGutter, options)))
    + "\n      </div> <!-- /.cell-padding -->\n    </td>\n  </tr>\n\n  <tr>\n    <td>\n      <div class=\"cell-padding\">\n        ";
  options = {hash:{},data:data};
  buffer += escapeExpression(((stack1 = helpers.view || depth0.view),stack1 ? stack1.call(depth0, depth0.settingVerticalPosition, options) : helperMissing.call(depth0, "view", depth0.settingVerticalPosition, options)))
    + "\n      </div> <!-- /.cell-padding -->\n    </td>\n    <td>\n      <div class=\"cell-padding\">\n        ";
  options = {hash:{},data:data};
  buffer += escapeExpression(((stack1 = helpers.view || depth0.view),stack1 ? stack1.call(depth0, depth0.settingHorizontalPosition, options) : helperMissing.call(depth0, "view", depth0.settingHorizontalPosition, options)))
    + "\n      </div> <!-- /.cell-padding -->\n    </td>\n  </tr>\n\n</table>\n\n";
  options = {hash:{},data:data};
  buffer += escapeExpression(((stack1 = helpers.view || depth0.view),stack1 ? stack1.call(depth0, depth0.footer, options) : helperMissing.call(depth0, "view", depth0.footer, options)))
    + "\n</form>\n";
  return buffer;
  });
});


define('hbs!templates/dropdown', ['handlebars'], function(Handlebars){ 
return Handlebars.template(function (Handlebars,depth0,helpers,partials,data) {
  this.compilerInfo = [4,'>= 1.0.0'];
helpers = this.merge(helpers, Handlebars.helpers); data = data || {};
  var buffer = "", stack1, stack2, options, functionType="function", escapeExpression=this.escapeExpression, helperMissing=helpers.helperMissing;


  buffer += "<div class=\"trough\">\n\n  <a href=\"\" class=\"js-dropdown-target target\">\n    <div class=\"item\">\n      <span class=\"icon js-selected-icon\">";
  if (stack1 = helpers.selectedIcon) { stack1 = stack1.call(depth0, {hash:{},data:data}); }
  else { stack1 = depth0.selectedIcon; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  if(stack1 || stack1 === 0) { buffer += stack1; }
  buffer += "</span>\n      <span class=\"label\">\n        <div style=\"width: 100%;\">\n          <span class=\"js-selected-value overflow\">";
  if (stack1 = helpers.selectedValue) { stack1 = stack1.call(depth0, {hash:{},data:data}); }
  else { stack1 = depth0.selectedValue; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  buffer += escapeExpression(stack1)
    + "</span>\n        </div>\n      </span>\n    </div>\n    <span class=\"arrow button\"></span>\n  </a>\n\n  ";
  options = {hash:{},data:data};
  buffer += escapeExpression(((stack1 = helpers.view || depth0.view),stack1 ? stack1.call(depth0, depth0.optionsView, options) : helperMissing.call(depth0, "view", depth0.optionsView, options)))
    + "\n\n  <input class=\"js-input\" type=\"hidden\" name=\"";
  if (stack2 = helpers.name) { stack2 = stack2.call(depth0, {hash:{},data:data}); }
  else { stack2 = depth0.name; stack2 = typeof stack2 === functionType ? stack2.apply(depth0) : stack2; }
  buffer += escapeExpression(stack2)
    + "\" value=\"";
  if (stack2 = helpers.value) { stack2 = stack2.call(depth0, {hash:{},data:data}); }
  else { stack2 = depth0.value; stack2 = typeof stack2 === functionType ? stack2.apply(depth0) : stack2; }
  buffer += escapeExpression(stack2)
    + "\">\n\n  <div class=\"js-backplate backplate\"></div>\n\n</div>\n";
  return buffer;
  });
});


(function() {
  var __hasProp = {}.hasOwnProperty,
    __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; };

  define('cs!collection-view',['thorax'], function(Thorax) {
    var CollectionView;
    return CollectionView = (function(_super) {

      __extends(CollectionView, _super);

      function CollectionView() {
        return CollectionView.__super__.constructor.apply(this, arguments);
      }

      return CollectionView;

    })(Thorax.CollectionView);
  });

}).call(this);


(function() {

  define('cs!views/dropdown-item',['cs!view'], function(View, template) {
    return View.extend({
      name: 'dropdown-item',
      tagName: "li",
      events: {
        'click .js-item': 'onClick'
      },
      onClick: function(event) {
        event.preventDefault();
        return this.parent.trigger('item:click', this);
      }
    });
  });

}).call(this);


define('hbs!templates/dropdown-options-item', ['handlebars'], function(Handlebars){ 
return Handlebars.template(function (Handlebars,depth0,helpers,partials,data) {
  this.compilerInfo = [4,'>= 1.0.0'];
helpers = this.merge(helpers, Handlebars.helpers); data = data || {};
  var buffer = "", stack1, functionType="function", escapeExpression=this.escapeExpression;


  buffer += "<a href=\"\" class=\"item js-item\">\n  <span class=\"icon\">";
  if (stack1 = helpers.icon) { stack1 = stack1.call(depth0, {hash:{},data:data}); }
  else { stack1 = depth0.icon; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  if(stack1 || stack1 === 0) { buffer += stack1; }
  buffer += "</span><span class=\"label overflow\">";
  if (stack1 = helpers.name) { stack1 = stack1.call(depth0, {hash:{},data:data}); }
  else { stack1 = depth0.name; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  buffer += escapeExpression(stack1)
    + "</span>\n</a>\n";
  return buffer;
  });
});


define('hbs!templates/dropdown-options-empty', ['handlebars'], function(Handlebars){ 
return Handlebars.template(function (Handlebars,depth0,helpers,partials,data) {
  this.compilerInfo = [4,'>= 1.0.0'];
helpers = this.merge(helpers, Handlebars.helpers); data = data || {};
  var buffer = "";


  return buffer;
  });
});


(function() {

  define('cs!views/dropdown-options',['cs!collection-view', 'cs!views/dropdown-item', 'hbs!templates/dropdown-options-item', 'hbs!templates/dropdown-options-empty'], function(CollectionView, DropdownItemView, itemTemplate, emptyTemplate) {
    return CollectionView.extend({
      name: 'dropdown-options',
      itemTemplate: itemTemplate,
      itemView: DropdownItemView,
      emptyTemplate: emptyTemplate,
      tagName: 'ul',
      className: 'options',
      events: {
        'item:click': 'onItemClick'
      },
      onItemClick: function(item) {
        return this.parent.trigger('update', item);
      }
    });
  });

}).call(this);


(function() {

  define('cs!models/dropdown',['cs!model'], function(Model) {
    return Model.extend({
      name: 'dropdown',
      defaults: {
        value: ''
      }
    });
  });

}).call(this);


(function() {

  define('cs!views/dropdown',['cs!view', 'hbs!templates/dropdown', 'cs!views/dropdown-options', 'cs!models/dropdown', 'cs!lib/messages', 'hbs!templates/icons'], function(View, template, OptionsView, Dropdown, Messages, Icons) {
    return View.extend({
      name: 'dropdown',
      template: template,
      tagName: 'div',
      className: 'dropdown js-dropdown',
      events: {
        'click .js-dropdown-target': 'onClickDropdownTarget',
        'click .js-backplate': 'onClickBackplate',
        'update': 'selectOption'
      },
      initialize: function(attributes) {
        if (attributes == null) {
          attributes = {};
        }
        if (this.extraClasses) {
          this.$el.addClass(attributes.extraClasses);
        }
        this.model = new Dropdown({
          value: this.selectedId
        });
        this.optionsView = new OptionsView({
          collection: new Thorax.Collection(this.optionsFromIDs(this.options))
        });
        return this.updateDisplayValues();
      },
      get: function(val) {
        return this.model.get(val);
      },
      optionsFromIDs: function(opts) {
        var _this = this;
        return _.map(opts, function(opt) {
          var iconOpts;
          iconOpts = {
            rotate: opt.icon.rotate,
            classes: opt.icon.classes
          };
          iconOpts[opt.icon.id] = true;
          return {
            id: opt.id,
            name: Messages.get(opt.messageID),
            icon: Icons(iconOpts),
            classes: opt.icon.classes
          };
        });
      },
      onClickDropdownTarget: function(event) {
        event.preventDefault();
        return this.toggleDropdown();
      },
      onClickBackplate: function(event) {
        event.preventDefault();
        return this.toggleDropdown();
      },
      toggleDropdown: function() {
        return this.$el.toggleClass('is-open');
      },
      toggleVisibility: function(status) {
        return this.$el.toggleClass('is-transparent', !status);
      },
      updateDisplayValues: function() {
        var item;
        item = this.optionsView.collection.findWhere({
          id: this.selectedId
        });
        return this.model.set({
          selectedIcon: item.get('icon'),
          selectedValue: item.get('name')
        });
      },
      selectOption: function(item, options) {
        if (options == null) {
          options = {};
        }
        this.model.set('value', item.model.get('id'));
        this.$('.js-input').val(item.model.get('id'));
        this.$('.js-selected-value').text(item.model.get('name'));
        this.$('.js-selected-icon').html(item.model.get('icon'));
        this.$el.removeClass('is-open');
        if (!options.silent) {
          return this.trigger('refreshCustom');
        }
      },
      selectByIndex: function(i, options) {
        var model;
        if (options == null) {
          options = {};
        }
        i = parseInt(i);
        if (model = this.optionsView.collection.at(i)) {
          return this.selectOption({
            model: model
          }, options);
        }
      },
      val: function(val, options) {
        var i;
        if (options == null) {
          options = {};
        }
        if (val != null) {
          i = typeof val === 'string' ? this.index(val) : val;
          return this.selectByIndex(i, options);
        } else {
          return this.model.get('value');
        }
      },
      index: function(val) {
        var model;
        model = this.optionsView.collection.findWhere({
          id: val || this.model.get('value')
        });
        return this.optionsView.collection.indexOf(model);
      }
    });
  });

}).call(this);


define('hbs!templates/iconned-input', ['handlebars'], function(Handlebars){ 
return Handlebars.template(function (Handlebars,depth0,helpers,partials,data) {
  this.compilerInfo = [4,'>= 1.0.0'];
helpers = this.merge(helpers, Handlebars.helpers); data = data || {};
  var buffer = "", stack1, functionType="function", escapeExpression=this.escapeExpression;


  buffer += "<div class=\"trough\">\n  <div class=\"input-padding\">\n    <div class=\"icon-holder\">\n      <a class=\"js-distribute distribute\" href=\"\" tabindex=\"-1\">\n        ";
  if (stack1 = helpers.iconSVG) { stack1 = stack1.call(depth0, {hash:{},data:data}); }
  else { stack1 = depth0.iconSVG; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  if(stack1 || stack1 === 0) { buffer += stack1; }
  buffer += "\n      </a>\n    </div>\n    <input type=\"text\" id=\"";
  if (stack1 = helpers.formName) { stack1 = stack1.call(depth0, {hash:{},data:data}); }
  else { stack1 = depth0.formName; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  buffer += escapeExpression(stack1)
    + "\" name=\"";
  if (stack1 = helpers.formName) { stack1 = stack1.call(depth0, {hash:{},data:data}); }
  else { stack1 = depth0.formName; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  buffer += escapeExpression(stack1)
    + "\" value=\"\" placeholder=\"";
  if (stack1 = helpers.placeholder) { stack1 = stack1.call(depth0, {hash:{},data:data}); }
  else { stack1 = depth0.placeholder; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  buffer += escapeExpression(stack1)
    + "\" spellcheck=\"false\">\n  </div>\n</div>\n";
  return buffer;
  });
});


(function() {

  define('cs!views/iconned-input',['cs!view', 'hbs!templates/iconned-input', 'cs!lib/messages', 'hbs!templates/icons'], function(View, template, Messages, Icons) {
    return View.extend({
      name: 'iconned-input',
      template: template,
      className: 'iconned-input',
      options: {
        integerOnly: false,
        single: false
      },
      events: {
        'focus input': 'onFocusInput',
        'blur input': 'onBlurInput',
        'keyup input': 'onKeyup',
        'mouseover .js-distribute': 'onDistributeOver',
        'mouseout .js-distribute': 'onDistributeOut',
        'click .js-distribute': 'onDistributeClick'
      },
      initialize: function(attributes) {
        if (this.extraClasses) {
          this.$el.addClass(this.extraClasses);
        }
        this.model = new Backbone.Model();
        this.listenTo(this.parent.model, 'change:vertical', this.updateDisplayValues);
        return this.updateDisplayValues();
      },
      onDistributeOver: function(event) {
        if (!(this.parent && this.distributeTo)) {
          return;
        }
        return this.parent.trigger('toggleDistribute', {
          val: true,
          inputs: this.distributeTo
        });
      },
      onDistributeOut: function(event) {
        if (!(this.parent && this.distributeTo)) {
          return;
        }
        return this.parent.trigger('toggleDistribute', {
          val: false,
          inputs: this.distributeTo
        });
      },
      onDistributeClick: function(event) {
        event.preventDefault();
        if (!(this.parent && this.distributeTo)) {
          return;
        }
        return this.parent.trigger('distribute', {
          val: this.val(),
          inputs: this.distributeTo,
          type: this.icon ? this.icon.replace(/first|last/, '') : void 0
        });
      },
      toggleDistribute: function(val) {
        return this.$el.toggleClass('is-highlighting-distribute', val);
      },
      onFocusInput: function(event) {
        this.$el.addClass('is-focused');
        if (this.parent) {
          this.parent.trigger('input:focused');
        }
        return this.$('input').select();
      },
      onBlurInput: function(event) {
        var _this = this;
        this.$el.removeClass('is-focused');
        return this.format(this.val(), function(val) {
          return _this.val(val);
        });
      },
      onKeyup: function(event) {
        if (event.which !== 13) {
          return;
        }
        this.$('input').blur();
        if (this.parent) {
          return this.parent.trigger('enterPressed');
        }
      },
      format: function(str, callback) {
        var _this = this;
        if (this.options.integerOnly) {
          return callback((parseInt(str) || '').toString());
        }
        return this.app.bridge.getDocumentRulerUnits(function(units) {
          var commands, end, type;
          type = units || 'px';
          commands = str.split(/[\|,\s]+/gi);
          end = _this.options.single ? _this.options.single : commands.length + 1;
          commands = _.map(commands.slice(0, end), function(command) {
            var cmd, value;
            if (command !== '~' && isNaN(parseFloat(command))) {
              return callback("");
            }
            if (command === '~') {
              return callback("~");
            }
            cmd = Unit.parse(command) || Unit.parse(parseFloat(str).toString());
            value = cmd.value != null ? cmd.value : cmd;
            type = cmd.type != null ? cmd.type : type;
            return "" + (type === "px" ? Math.floor(value) : value) + type;
          });
          return callback(_.compact(commands).join(' | '));
        });
      },
      updateDisplayValues: function() {
        var iconOpts;
        iconOpts = {
          rotate: this.rotate
        };
        iconOpts[this.icon] = true;
        return this.model.set({
          placeholder: Messages.get(this.messageID),
          iconSVG: Icons(iconOpts)
        });
      },
      val: function(val, options) {
        var status;
        if (options == null) {
          options = {};
        }
        if (val != null) {
          status = val ? true : false;
          this.trigger('inputChange', {
            status: status,
            willToggle: this.willToggle
          });
          this.$('input').val(val);
          if (!options.silent) {
            this.trigger('refreshCustom');
          }
        }
        return this.$('input').val();
      }
    });
  });

}).call(this);


(function() {

  define('cs!models/grid',['cs!model', 'cs!lib/messages'], function(Model, Messages) {
    return Model.extend({
      name: 'grid',
      defaults: {
        name: Messages.get('titleUntitledGrid')
      },
      formDefaults: {
        columnCount: '',
        columnWidth: '',
        columnWidthSplit: false,
        columnGutter: '',
        columnGutterSplit: false,
        leftMargin: '',
        rightMargin: '',
        verticalPosition: 'f',
        rowCount: '',
        rowHeight: '',
        rowHeightSplit: false,
        rowGutter: '',
        rowGutterSplit: false,
        topMargin: '',
        bottomMargin: '',
        horizontalPosition: 'f'
      },
      initialize: function(attributes, options) {
        if (attributes == null) {
          attributes = {};
        }
        if (options == null) {
          options = {};
        }
        if (options.exSet) {
          return this.exSet(options.exSet);
        }
      },
      exSet: function() {
        var attrs, form, gn;
        attrs = {};
        if (arguments.length > 2) {
          attrs[arguments[0]] = arguments[1];
        }
        if (typeof arguments[0] === 'object') {
          attrs = _.extend({}, arguments[0]);
        }
        if (form = attrs['form']) {
          this.unset('notation', {
            silent: true
          });
          attrs['form'] = _.extend({}, this.formDefaults, form);
        } else if (gn = attrs['notation']) {
          this.unset('form', {
            silent: true
          });
        }
        this.set(attrs);
        return this;
      },
      type: function() {
        if (this.get('form') != null) {
          return 'form';
        } else {
          return 'custom';
        }
      },
      getFormValues: function() {
        return _.extend({}, this.attributes);
      }
    });
  });

}).call(this);


(function() {

  define('cs!views/form',['cs!view', 'hbs!templates/form', 'cs!lib/messages', 'cs!views/dropdown', 'cs!views/iconned-input', 'cs!views/text-input', 'cs!views/footer', 'hbs!templates/icons', 'cs!models/grid'], function(View, template, Messages, DropdownView, IconnedInputView, TextInputView, FooterView, Icons, Grid) {
    return View.extend({
      name: 'form',
      template: template,
      className: 'js-ez-form js-edit-form ez-form',
      initialize: function(attributes, options) {
        var _ref;
        this.msgName = Messages.get('placeholderName');
        this.formButtons = {
          collection: [
            {
              label: Messages.get('btnAddGuides'),
              name: 'addGuides'
            }
          ],
          more: [
            {
              label: Messages.get('btnResetForm'),
              name: 'resetForm'
            }
          ]
        };
        if (((_ref = this.app) != null ? _ref.localStorage : void 0) && !this.app.freeVersion) {
          this.formButtons.more.unshift({
            label: Messages.get('btnSaveGrid'),
            name: 'saveGrid'
          });
        }
        this.editButtons = {
          collection: [
            {
              label: Messages.get('btnSaveGrid'),
              name: 'editSave'
            }, {
              label: Messages.get('btnCancel'),
              name: 'editCancel'
            }
          ],
          more: []
        };
        this.model = new Backbone.Model();
        this.gridName = new TextInputView({
          placeholder: this.msgName,
          extraClasses: 'name-field'
        });
        this.dist = {
          margins: ['fieldRightMargin', 'fieldTopMargin', 'fieldBottomMargin', 'fieldLeftMargin'],
          counts: ['fieldColumnCount', 'fieldRowCount'],
          measures: ['fieldColumnWidth', 'fieldRowHeight'],
          gutters: ['fieldColumnGutter', 'fieldRowGutter']
        };
        this.fieldLeftMargin = new IconnedInputView({
          parent: this,
          app: this.app,
          extraClasses: 'js-input-left-margin',
          messageID: 'inputMargin',
          name: 'inputLeftMargin',
          icon: 'firstmargin',
          distributeTo: this.dist.margins
        });
        this.fieldRightMargin = new IconnedInputView({
          parent: this,
          app: this.app,
          extraClasses: 'js-input-right-margin',
          messageID: 'inputMargin',
          name: 'inputRightMargin',
          icon: 'lastmargin',
          distributeTo: this.dist.margins
        });
        this.fieldTopMargin = new IconnedInputView({
          parent: this,
          app: this.app,
          extraClasses: 'js-input-top-margin',
          messageID: 'inputMargin',
          name: 'inputTopMargin',
          icon: 'firstmargin',
          rotate: true,
          distributeTo: this.dist.margins
        });
        this.fieldBottomMargin = new IconnedInputView({
          parent: this,
          app: this.app,
          extraClasses: 'js-input-bottom-margin',
          messageID: 'inputMargin',
          name: 'inputBottomMargin',
          icon: 'lastmargin',
          rotate: true,
          distributeTo: this.dist.margins
        });
        this.fieldColumnCount = new IconnedInputView({
          parent: this,
          app: this.app,
          extraClasses: 'js-input-column-count',
          messageID: 'inputColumns',
          name: 'inputColumns',
          icon: 'count',
          distributeTo: this.dist.counts,
          options: {
            integerOnly: true
          }
        });
        this.fieldRowCount = new IconnedInputView({
          parent: this,
          app: this.app,
          extraClasses: 'js-input-row-count',
          messageID: 'inputRows',
          name: 'inputRows',
          icon: 'count',
          rotate: true,
          distributeTo: this.dist.counts,
          options: {
            integerOnly: true
          }
        });
        this.fieldColumnWidth = new IconnedInputView({
          parent: this,
          app: this.app,
          extraClasses: 'js-input-column-width',
          messageID: 'inputWidth',
          name: 'inputWidth',
          icon: 'measure',
          willToggle: 'settingVerticalPosition',
          distributeTo: this.dist.measures
        });
        this.fieldRowHeight = new IconnedInputView({
          parent: this,
          app: this.app,
          extraClasses: 'js-input-rowHeight',
          messageID: 'inputHeight',
          name: 'inputHeight',
          icon: 'measure',
          rotate: true,
          willToggle: 'settingHorizontalPosition',
          distributeTo: this.dist.measures
        });
        this.fieldColumnGutter = new IconnedInputView({
          parent: this,
          app: this.app,
          extraClasses: 'js-input-column-gutter',
          messageID: 'inputGutter',
          name: 'inputColumnGutter',
          icon: 'gutter',
          distributeTo: this.dist.gutters
        });
        this.fieldRowGutter = new IconnedInputView({
          parent: this,
          app: this.app,
          extraClasses: 'js-input-row-gutter',
          messageID: 'inputGutter',
          name: 'inputRowGutter',
          icon: 'gutter',
          rotate: true,
          distributeTo: this.dist.gutters
        });
        this.settingVerticalPosition = new DropdownView({
          name: 'dropdownVerticalPosition',
          parent: this,
          app: this.app,
          extraClasses: 'js-setting-vertical-position is-transparent',
          selectedId: 'f',
          options: [
            {
              id: 'f',
              messageID: 'dropdownLeft',
              icon: {
                id: 'firstposition'
              }
            }, {
              id: 'c',
              messageID: 'dropdownCenter',
              icon: {
                id: 'centerposition'
              }
            }, {
              id: 'l',
              messageID: 'dropdownRight',
              icon: {
                id: 'lastposition'
              }
            }
          ]
        });
        this.settingHorizontalPosition = new DropdownView({
          name: 'dropdownHorizontalPosition',
          parent: this,
          app: this.app,
          extraClasses: 'js-setting-horizontal-position is-transparent',
          selectedId: 'f',
          options: [
            {
              id: 'f',
              messageID: 'dropdownTop',
              icon: {
                id: 'firstposition',
                rotate: true
              }
            }, {
              id: 'c',
              messageID: 'dropdownCenter',
              icon: {
                id: 'centerposition',
                rotate: true
              }
            }, {
              id: 'l',
              messageID: 'dropdownBottom',
              icon: {
                id: 'lastposition',
                rotate: true
              }
            }
          ]
        });
        this.footer = new FooterView({
          app: this.app,
          quickGuides: true,
          buttons: this.formButtons
        });
        this.formFields = {
          name: {
            input: this.gridName,
            "default": ''
          },
          columnCount: {
            input: this.fieldColumnCount,
            "default": ''
          },
          columnWidth: {
            input: this.fieldColumnWidth,
            "default": ''
          },
          columnGutter: {
            input: this.fieldColumnGutter,
            "default": ''
          },
          leftMargin: {
            input: this.fieldLeftMargin,
            "default": ''
          },
          rightMargin: {
            input: this.fieldRightMargin,
            "default": ''
          },
          verticalPosition: {
            input: this.settingVerticalPosition,
            "default": 'f'
          },
          rowCount: {
            input: this.fieldRowCount,
            "default": ''
          },
          rowHeight: {
            input: this.fieldRowHeight,
            "default": ''
          },
          rowGutter: {
            input: this.fieldRowGutter,
            "default": ''
          },
          topMargin: {
            input: this.fieldTopMargin,
            "default": ''
          },
          bottomMargin: {
            input: this.fieldBottomMargin,
            "default": ''
          },
          horizontalPosition: {
            input: this.settingHorizontalPosition,
            "default": 'f'
          }
        };
        this.listenTo(this, 'enterPressed', this.onEnterPressed);
        this.listenTo(this, 'toggleDistribute', this.toggleDistribute);
        this.listenTo(this, 'distribute', this.distribute);
        this.listenTo(this.footer, 'buttonClick', this.footerEventRouter);
        this.listenTo(this.fieldColumnWidth, 'inputChange', this.togglePosition);
        this.listenTo(this.fieldRowHeight, 'inputChange', this.togglePosition);
        this.listenTo(this.fieldLeftMargin, 'refreshCustom', this.onInputChange);
        this.listenTo(this.fieldRightMargin, 'refreshCustom', this.onInputChange);
        this.listenTo(this.fieldTopMargin, 'refreshCustom', this.onInputChange);
        this.listenTo(this.fieldBottomMargin, 'refreshCustom', this.onInputChange);
        this.listenTo(this.fieldColumnCount, 'refreshCustom', this.onInputChange);
        this.listenTo(this.fieldRowCount, 'refreshCustom', this.onInputChange);
        this.listenTo(this.fieldColumnWidth, 'refreshCustom', this.onInputChange);
        this.listenTo(this.fieldRowHeight, 'refreshCustom', this.onInputChange);
        this.listenTo(this.fieldColumnGutter, 'refreshCustom', this.onInputChange);
        this.listenTo(this.fieldRowGutter, 'refreshCustom', this.onInputChange);
        this.listenTo(this.settingVerticalPosition, 'refreshCustom', this.onInputChange);
        return this.listenTo(this.settingHorizontalPosition, 'refreshCustom', this.onInputChange);
      },
      onInputChange: function() {
        if (/\~/.test(this.fieldColumnWidth.val()) && !this.fieldColumnCount.val()) {
          this.fieldColumnCount.val('1');
        }
        if (/\~/.test(this.fieldRowHeight.val()) && !this.fieldRowCount.val()) {
          this.fieldRowCount.val('1');
        }
        return this.trigger('refreshCustom', this.notationFromForm());
      },
      toggleDistribute: function(data) {
        var input, _i, _len, _ref, _results;
        _ref = data.inputs;
        _results = [];
        for (_i = 0, _len = _ref.length; _i < _len; _i++) {
          input = _ref[_i];
          _results.push(this[input].toggleDistribute(data.val));
        }
        return _results;
      },
      distribute: function(data) {
        var input, _i, _len, _ref;
        _ref = data.inputs;
        for (_i = 0, _len = _ref.length; _i < _len; _i++) {
          input = _ref[_i];
          this[input].val(data.val);
        }
        return typeof ga === "function" ? ga('event', 'Form', 'Distribute', data.type) : void 0;
      },
      togglePosition: function(data) {
        return this[data.willToggle].toggleVisibility(data.status);
      },
      footerEventRouter: function(button) {
        switch (button) {
          case 'addGuides':
            return this.addGuides(function() {
              return typeof ga === "function" ? ga('event', 'Form', 'Add guides', 'click') : void 0;
            });
          case 'resetForm':
            this.val({});
            this.trigger('refreshCustom', this.notationFromForm());
            return typeof ga === "function" ? ga('event', 'Form', 'Reset') : void 0;
          case 'editCancel':
            return this.hideEditForm();
          case 'saveGrid':
          case 'editSave':
            return this.saveGridFromForm();
          default:
            return this.trigger('buttonClick', button);
        }
      },
      getSnapValue: function() {
        if (this.app.freeVersion) {
          return '';
        }
        if (this.app.snap) {
          return 'p';
        } else {
          return '';
        }
      },
      onEnterPressed: function() {
        this.$el.focus();
        if (this.editing) {
          return this.saveGridFromForm();
        }
        return this.addGuides(function() {
          return typeof ga === "function" ? ga('event', 'Form', 'Add guides', 'enter') : void 0;
        });
      },
      addGuides: function(callback) {
        var gn;
        gn = this.notationFromForm();
        this.trigger('addGuides', gn || ("| ~ | ( vl" + (this.getSnapValue()) + " )\n| ~ | ( hl" + (this.getSnapValue()) + " )"));
        if (callback) {
          return callback();
        }
      },
      saveGridFromForm: function() {
        var data, model, name;
        if (this.editing == null) {
          return this.showEditForm();
        }
        model = this.editing.clone();
        data = this.val();
        name = data.name;
        delete data.name;
        model.exSet({
          name: name,
          form: this.val()
        });
        if (model.get('name').trim() === "") {
          model.set('name', model.defaults.name);
        }
        model.set('selected', false);
        return this.trigger('save', model);
      },
      notationFromForm: function() {
        var data, str1, str2;
        data = this.val();
        str1 = GridNotation.stringify({
          count: data.columnCount,
          width: data.columnWidth,
          gutter: data.columnGutter,
          firstMargin: data.leftMargin,
          lastMargin: data.rightMargin,
          orientation: 'v',
          position: data.verticalPosition,
          calculation: this.getSnapValue(),
          remainder: 'l'
        });
        str2 = GridNotation.stringify({
          count: data.rowCount,
          width: data.rowHeight,
          gutter: data.rowGutter,
          firstMargin: data.topMargin,
          lastMargin: data.bottomMargin,
          orientation: 'h',
          position: data.horizontalPosition,
          calculation: this.getSnapValue(),
          remainder: 'l'
        });
        return "" + (str1 || '') + (str1 && str2 ? '\n' : '') + (str2 || '');
      },
      val: function(data) {
        var k, obj, v, _ref, _ref1;
        if (data != null) {
          _ref = this.formFields;
          for (k in _ref) {
            v = _ref[k];
            v.input.val(data[k] || v["default"], {
              silent: true
            });
          }
          return null;
        } else {
          obj = {};
          _ref1 = this.formFields;
          for (k in _ref1) {
            v = _ref1[k];
            obj[k] = v.input.val(null, {
              silent: true
            });
          }
          return obj;
        }
      },
      showEditForm: function(model) {
        var data;
        this.$el.addClass('is-editing');
        this.editing = model || new Grid();
        this.storedValues = this.val();
        if (this.editing.get('id') == null) {
          this.editing.set('form', this.storedValues);
        }
        data = this.editing.get('form');
        data.name = this.editing.get('name');
        this.val(data);
        this.footer.replaceButtons(this.editButtons);
        return this.trigger('edit:enable', 'form');
      },
      hideEditForm: function() {
        this.val(this.storedValues || []);
        this.footer.replaceButtons(this.formButtons);
        delete this.editing;
        delete this.storedValues;
        this.$el.removeClass('is-editing');
        return this.trigger('edit:disable');
      }
    });
  });

}).call(this);


define('hbs!templates/custom', ['handlebars'], function(Handlebars){ 
return Handlebars.template(function (Handlebars,depth0,helpers,partials,data) {
  this.compilerInfo = [4,'>= 1.0.0'];
helpers = this.merge(helpers, Handlebars.helpers); data = data || {};
  var buffer = "", stack1, stack2, options, functionType="function", escapeExpression=this.escapeExpression, helperMissing=helpers.helperMissing, self=this;

function program1(depth0,data) {
  
  var buffer = "", stack1;
  buffer += "\n\n    <div class=\"upsell-shell\">\n\n      <div class=\"fake-grid\">\n        <span class=\"guide\" style=\"left: 0%\"></span>\n        <span class=\"guide\" style=\"left: 1%\"></span>\n        <span class=\"guide\" style=\"left: 2%\"></span>\n        <span class=\"guide\" style=\"left: 3%\"></span>\n        <span class=\"guide\" style=\"left: 5%\"></span>\n        <span class=\"guide\" style=\"left: 8%\"></span>\n        <span class=\"guide\" style=\"left: 13%\"></span>\n        <span class=\"guide\" style=\"left: 21%\"></span>\n        <span class=\"guide\" style=\"left: 34%\"></span>\n        <span class=\"guide\" style=\"left: 55%\"></span>\n        <span class=\"guide\" style=\"left: 89%\"></span>\n        <span class=\"guide\" style=\"left: 100%\"></span>\n      </div>\n\n      <div class=\"fake-grid\">\n        <span class=\"guide\" style=\"left: 0%\"></span>\n        <span class=\"guide\" style=\"left: 2%\"></span>\n        <span class=\"guide\" style=\"left: 3%\"></span>\n        <span class=\"guide\" style=\"left: 5%\"></span>\n        <span class=\"guide\" style=\"left: 7%\"></span>\n        <span class=\"guide\" style=\"left: 11%\"></span>\n        <span class=\"guide\" style=\"left: 13%\"></span>\n        <span class=\"guide\" style=\"left: 17%\"></span>\n        <span class=\"guide\" style=\"left: 19%\"></span>\n        <span class=\"guide\" style=\"left: 23%\"></span>\n        <span class=\"guide\" style=\"left: 29%\"></span>\n        <span class=\"guide\" style=\"left: 31%\"></span>\n        <span class=\"guide\" style=\"left: 37%\"></span>\n        <span class=\"guide\" style=\"left: 41%\"></span>\n        <span class=\"guide\" style=\"left: 43%\"></span>\n        <span class=\"guide\" style=\"left: 47%\"></span>\n        <span class=\"guide\" style=\"left: 53%\"></span>\n        <span class=\"guide\" style=\"left: 59%\"></span>\n        <span class=\"guide\" style=\"left: 61%\"></span>\n        <span class=\"guide\" style=\"left: 67%\"></span>\n        <span class=\"guide\" style=\"left: 71%\"></span>\n        <span class=\"guide\" style=\"left: 73%\"></span>\n        <span class=\"guide\" style=\"left: 79%\"></span>\n        <span class=\"guide\" style=\"left: 83%\"></span>\n        <span class=\"guide\" style=\"left: 89%\"></span>\n        <span class=\"guide\" style=\"left: 97%\"></span>\n        <span class=\"guide\" style=\"left: 100%\"></span>\n      </div>\n\n      <div class=\"fake-grid\">\n        <span class=\"guide\" style=\"left: 0%\"></span>\n        <span class=\"guide\" style=\"left: 2%\"></span>\n        <span class=\"guide\" style=\"left: 4%\"></span>\n        <span class=\"guide\" style=\"left: 8%\"></span>\n        <span class=\"guide\" style=\"left: 16%\"></span>\n        <span class=\"guide\" style=\"left: 32%\"></span>\n        <span class=\"guide\" style=\"left: 64%\"></span>\n        <span class=\"guide\" style=\"left: 100%\"></span>\n      </div>\n\n      <div class=\"upsell-text\">\n        ";
  if (stack1 = helpers.msgUpsell) { stack1 = stack1.call(depth0, {hash:{},data:data}); }
  else { stack1 = depth0.msgUpsell; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  buffer += escapeExpression(stack1)
    + "\n      </div>\n    </div>\n\n  ";
  return buffer;
  }

function program3(depth0,data) {
  
  var buffer = "", stack1, stack2, options;
  buffer += "\n\n    ";
  options = {hash:{},data:data};
  buffer += escapeExpression(((stack1 = helpers.view || depth0.view),stack1 ? stack1.call(depth0, depth0.gridName, options) : helperMissing.call(depth0, "view", depth0.gridName, options)))
    + "\n\n    <div class=\"trough custom-input js-custom-input fit-above-buttons\">\n      <div class=\"outer-padding\">\n        <div class=\"graphics\">\n          <div class=\"inner-padding\">\n            <textarea placeholder=\"";
  if (stack2 = helpers.msgCustomPlaceholder) { stack2 = stack2.call(depth0, {hash:{},data:data}); }
  else { stack2 = depth0.msgCustomPlaceholder; stack2 = typeof stack2 === functionType ? stack2.apply(depth0) : stack2; }
  buffer += escapeExpression(stack2)
    + "\" class=\"js-custom-textarea\" spellcheck=\"false\"></textarea>\n          </div>\n        </div>\n      </div>\n\n      ";
  options = {hash:{},data:data};
  buffer += escapeExpression(((stack1 = helpers.view || depth0.view),stack1 ? stack1.call(depth0, depth0.error, options) : helperMissing.call(depth0, "view", depth0.error, options)))
    + "\n    </div>\n\n  ";
  return buffer;
  }

  buffer += "<div class=\"stretch-layout\">\n  ";
  stack2 = helpers['if'].call(depth0, ((stack1 = depth0.app),stack1 == null || stack1 === false ? stack1 : stack1.freeVersion), {hash:{},inverse:self.program(3, program3, data),fn:self.program(1, program1, data),data:data});
  if(stack2 || stack2 === 0) { buffer += stack2; }
  buffer += "\n\n</div>\n\n";
  options = {hash:{},data:data};
  buffer += escapeExpression(((stack1 = helpers.view || depth0.view),stack1 ? stack1.call(depth0, depth0.footer, options) : helperMissing.call(depth0, "view", depth0.footer, options)))
    + "\n";
  return buffer;
  });
});


define('hbs!templates/error', ['handlebars'], function(Handlebars){ 
return Handlebars.template(function (Handlebars,depth0,helpers,partials,data) {
  this.compilerInfo = [4,'>= 1.0.0'];
helpers = this.merge(helpers, Handlebars.helpers); data = data || {};
  var buffer = "", stack1, stack2, options, functionType="function", escapeExpression=this.escapeExpression, self=this, helperMissing=helpers.helperMissing;

function program1(depth0,data) {
  
  var buffer = "", stack1;
  buffer += "\n<li><span class=\"overflow\">";
  if (stack1 = helpers.message) { stack1 = stack1.call(depth0, {hash:{},data:data}); }
  else { stack1 = depth0.message; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  buffer += escapeExpression(stack1)
    + "</span></li>\n";
  return buffer;
  }

  options = {hash:{
    'tagName': ("ul")
  },inverse:self.noop,fn:self.program(1, program1, data),data:data};
  stack2 = ((stack1 = helpers.collection || depth0.collection),stack1 ? stack1.call(depth0, options) : helperMissing.call(depth0, "collection", options));
  if(stack2 || stack2 === 0) { buffer += stack2; }
  buffer += "\n";
  return buffer;
  });
});


(function() {

  define('cs!views/error',['cs!view', 'hbs!templates/error'], function(View, template) {
    return View.extend({
      name: 'error',
      template: template,
      className: 'custom-errors',
      collection: new Thorax.Collection
    });
  });

}).call(this);


(function() {

  define('cs!views/custom',['cs!view', 'hbs!templates/custom', 'cs!lib/messages', 'cs!views/text-input', 'cs!views/footer', 'cs!views/error', 'cs!models/grid'], function(View, template, Messages, TextInputView, FooterView, Error, Grid) {
    return View.extend({
      name: 'custom',
      template: template,
      className: 'js-edit-form custom-form',
      events: {
        'focus .js-custom-textarea': 'onFocusCustomForm',
        'blur .js-custom-textarea': 'onBlurCustomForm'
      },
      initialize: function(attributes, options) {
        var _ref;
        if (attributes == null) {
          attributes = {};
        }
        if (options == null) {
          options = {};
        }
        this.msgName = Messages.get('placeholderName');
        this.msgCustomPlaceholder = Messages.get('placeholderCustom');
        this.formButtons = {
          collection: [
            {
              label: Messages.get('btnAddGuides'),
              name: 'addGuides'
            }
          ],
          more: [
            {
              label: Messages.get('btnResetForm'),
              name: 'resetForm'
            }, {
              label: Messages.get('btnWhatIsThis'),
              name: 'help'
            }
          ]
        };
        if ((_ref = this.app) != null ? _ref.localStorage : void 0) {
          this.formButtons.more.unshift({
            label: Messages.get('btnSaveGrid'),
            name: 'saveGrid'
          });
        }
        this.editButtons = {
          collection: [
            {
              label: Messages.get('btnSaveGrid'),
              name: 'editSave'
            }, {
              label: Messages.get('btnCancel'),
              name: 'editCancel'
            }
          ],
          more: []
        };
        this.error = new Error();
        this.gridName = new TextInputView({
          placeholder: this.msgName,
          extraClasses: 'name-field'
        });
        this.msgUpsell = Messages.get('msgCustomUpsell');
        if (this.app.freeVersion) {
          this.footer = new FooterView({
            app: this.app,
            quickGuides: true,
            buttons: {
              collection: [
                {
                  label: Messages.get('btnLearnMore'),
                  name: 'buy'
                }
              ]
            }
          });
        } else {
          this.footer = new FooterView({
            app: this.app,
            quickGuides: true,
            buttons: this.formButtons
          });
        }
        return this.listenTo(this.footer, 'buttonClick', this.footerEventRouter);
      },
      footerEventRouter: function(button) {
        switch (button) {
          case 'addGuides':
            return this.addGuides(function() {
              return typeof ga === "function" ? ga('event', 'Custom', 'Add guides', 'click') : void 0;
            });
          case 'resetForm':
            this.resetForm();
            return typeof ga === "function" ? ga('event', 'Custom', 'Reset') : void 0;
          case 'help':
            this.getGridNotationHelp();
            return typeof ga === "function" ? ga('event', 'Custom', 'Help') : void 0;
          case 'buy':
            this.parent.trigger('openUrl', this.parent.buyUrl);
            return typeof ga === "function" ? ga('event', 'Upsell', 'From custom') : void 0;
          case 'editCancel':
            return this.hideEditForm();
          case 'saveGrid':
          case 'editSave':
            return this.saveGridFromForm();
          default:
            return this.trigger('buttonClick', button);
        }
      },
      addGuides: function(callback) {
        var gn;
        gn = this.captureFormData().notation;
        if (gn) {
          this.trigger('addGuides', gn);
          if (callback) {
            return callback();
          }
        }
      },
      resetForm: function() {
        this.$('.js-custom-textarea').val('');
        this.$('.js-custom-input').removeClass('is-focused has-error');
        this.footer.toggleButton('addGuides', false);
        this.footer.toggleButton('saveGrid', false);
        return this.error.collection.reset();
      },
      getGridNotationHelp: function() {
        var url;
        url = 'http://guideguide.me/documentation/grid-notation/';
        if (this.parent) {
          return this.parent.trigger('openUrl', url);
        }
      },
      onFocusCustomForm: function(event) {
        var $field;
        $field = $(event.currentTarget);
        this.footer.toggleButton('addGuides', false);
        this.footer.toggleButton('saveGrid', false);
        this.resetFormIndicators();
        return this.$('.js-custom-input').addClass('is-focused');
      },
      onBlurCustomForm: function(event) {
        return this.validateForm();
      },
      removeValidationTokens: function(str) {
        return str.replace(/[\{\}]|\[.*?\]|^#.*?$/gm, '').replace(/\s+$/g, '');
      },
      resetFormIndicators: function() {
        var $field;
        this.error.collection.reset();
        $field = this.$('.js-custom-textarea');
        $field.val(this.removeValidationTokens($field.val()));
        return this.$('.js-custom-input').removeClass('is-focused has-error');
      },
      validateForm: function() {
        var $field, errors, str;
        this.resetFormIndicators();
        $field = this.$('.js-custom-textarea');
        str = $field.val();
        if (str.trim() === '') {
          return;
        }
        $field.val(GridNotation.clean(str));
        errors = GridNotation.test(str);
        if (errors.length) {
          this.footer.toggleButton('addGuides', true);
          this.footer.toggleButton('saveGrid', true);
          this.$('.js-custom-input').addClass('has-error');
          return this.error.collection.add(_.map(errors, function(error) {
            var message;
            message = Messages.get("gnError" + error);
            return {
              message: "" + error + ". " + message
            };
          }));
        }
      },
      captureFormData: function() {
        return {
          name: this.gridName.val(),
          notation: this.removeValidationTokens(this.$('.js-custom-textarea').val())
        };
      },
      saveGridFromForm: function() {
        var model;
        if (this.editing == null) {
          return this.showEditForm();
        }
        model = this.editing.clone();
        model.exSet(this.captureFormData());
        if (model.get('name').trim() === "") {
          model.set('name', model.defaults.name);
        }
        model.set('selected', false);
        if (!GridNotation.test(model.get('notation')).length) {
          return this.trigger('save', model);
        }
      },
      prefillForm: function(notation, name) {
        this.gridName.val(name || '');
        this.$('.js-custom-textarea').val(notation || '');
        return this.validateForm();
      },
      showEditForm: function(model) {
        this.$el.addClass('is-editing');
        this.editing = model || new Grid();
        this.storedValue = this.captureFormData().notation || '';
        if ((this.storedValue != null) && (this.editing.get('id') == null)) {
          this.editing.set('notation', this.storedValue);
        }
        this.prefillForm(this.editing.get('notation'), this.editing.get('name'));
        this.footer.replaceButtons(this.editButtons);
        return this.trigger('edit:enable', 'custom');
      },
      hideEditForm: function() {
        this.prefillForm(this.storedValue || '');
        this.footer.replaceButtons(this.formButtons);
        delete this.editing;
        delete this.storedValue;
        this.$el.removeClass('is-editing');
        return this.trigger('edit:disable');
      }
    });
  });

}).call(this);


define('hbs!templates/saved', ['handlebars'], function(Handlebars){ 
return Handlebars.template(function (Handlebars,depth0,helpers,partials,data) {
  this.compilerInfo = [4,'>= 1.0.0'];
helpers = this.merge(helpers, Handlebars.helpers); data = data || {};
  var buffer = "", stack1, stack2, options, functionType="function", escapeExpression=this.escapeExpression, helperMissing=helpers.helperMissing, self=this;

function program1(depth0,data) {
  
  var buffer = "", stack1;
  buffer += "\n      <div class=\"upsell-shell\">\n        <div class=\"fake-saved\">\n          <div class=\"graphic\">\n            Bootstrap\n          </div>\n        </div>\n        <div class=\"fake-saved\">\n          <div class=\"graphic\">\n            Gridism\n          </div>\n        </div>\n        <div class=\"fake-saved\">\n          <div class=\"graphic\">\n            Neat\n          </div>\n        </div>\n\n        <div class=\"upsell-text\">\n          ";
  if (stack1 = helpers.msgUpsell) { stack1 = stack1.call(depth0, {hash:{},data:data}); }
  else { stack1 = depth0.msgUpsell; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  buffer += escapeExpression(stack1)
    + "\n        </div>\n      </div>\n    ";
  return buffer;
  }

function program3(depth0,data) {
  
  var buffer = "", stack1, options;
  buffer += "\n      <div class=\"trough saved-list js-custom-input fit-above-buttons\">\n        <div class=\"outer-padding\">\n          <div class=\"graphics\">\n            <div class=\"inner-padding\">\n              ";
  options = {hash:{},data:data};
  buffer += escapeExpression(((stack1 = helpers.view || depth0.view),stack1 ? stack1.call(depth0, depth0.grids, options) : helperMissing.call(depth0, "view", depth0.grids, options)))
    + "\n            </div>\n          </div>\n        </div>\n      </div>\n    ";
  return buffer;
  }

  buffer += "<div class=\"push-below-tabs\">\n  <div class=\"stretch-layout\">\n    ";
  stack2 = helpers['if'].call(depth0, ((stack1 = depth0.app),stack1 == null || stack1 === false ? stack1 : stack1.freeVersion), {hash:{},inverse:self.program(3, program3, data),fn:self.program(1, program1, data),data:data});
  if(stack2 || stack2 === 0) { buffer += stack2; }
  buffer += "\n\n  </div>\n\n  ";
  options = {hash:{},data:data};
  buffer += escapeExpression(((stack1 = helpers.view || depth0.view),stack1 ? stack1.call(depth0, depth0.footer, options) : helperMissing.call(depth0, "view", depth0.footer, options)))
    + "\n</div>\n";
  return buffer;
  });
});


define('hbs!templates/savedgrids-item', ['handlebars'], function(Handlebars){ 
return Handlebars.template(function (Handlebars,depth0,helpers,partials,data) {
  this.compilerInfo = [4,'>= 1.0.0'];
helpers = this.merge(helpers, Handlebars.helpers); data = data || {};
  var buffer = "", stack1, options, self=this, functionType="function", blockHelperMissing=helpers.blockHelperMissing, escapeExpression=this.escapeExpression;

function program1(depth0,data) {
  
  
  return "is-selected";
  }

  buffer += "<a href=\"\" tabindex=\"-1\" class=\"js-item item ";
  options = {hash:{},inverse:self.noop,fn:self.program(1, program1, data),data:data};
  if (stack1 = helpers.selected) { stack1 = stack1.call(depth0, options); }
  else { stack1 = depth0.selected; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  if (!helpers.selected) { stack1 = blockHelperMissing.call(depth0, stack1, options); }
  if(stack1 || stack1 === 0) { buffer += stack1; }
  buffer += "\">";
  if (stack1 = helpers.name) { stack1 = stack1.call(depth0, {hash:{},data:data}); }
  else { stack1 = depth0.name; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  buffer += escapeExpression(stack1)
    + "</a>\n";
  return buffer;
  });
});


define('hbs!templates/savedgrids-empty', ['handlebars'], function(Handlebars){ 
return Handlebars.template(function (Handlebars,depth0,helpers,partials,data) {
  this.compilerInfo = [4,'>= 1.0.0'];
helpers = this.merge(helpers, Handlebars.helpers); data = data || {};
  var buffer = "", stack1, functionType="function", escapeExpression=this.escapeExpression;


  buffer += "<li>\n  ";
  if (stack1 = helpers.msgBlankSlate) { stack1 = stack1.call(depth0, {hash:{},data:data}); }
  else { stack1 = depth0.msgBlankSlate; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  buffer += escapeExpression(stack1)
    + "\n\n  <a class=\"button js-restore-defaults\" href=\"\">";
  if (stack1 = helpers.msgAddDefaultGrids) { stack1 = stack1.call(depth0, {hash:{},data:data}); }
  else { stack1 = depth0.msgAddDefaultGrids; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  buffer += escapeExpression(stack1)
    + "</a>\n</li>\n";
  return buffer;
  });
});


(function() {

  define('cs!views/saved-grid',['cs!view'], function(View, template) {
    return View.extend({
      name: 'saved-grid',
      tagName: "li",
      events: {
        'click .js-item': 'onClick'
      },
      onClick: function(event) {
        event.preventDefault();
        this.model.set('selected', !this.model.get('selected', {
          silent: true
        }));
        return this.parent.trigger('item:click', this);
      }
    });
  });

}).call(this);


(function() {
  var __hasProp = {}.hasOwnProperty,
    __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; };

  define('cs!collection',['thorax'], function(Thorax) {
    var Collection;
    return Collection = (function(_super) {

      __extends(Collection, _super);

      function Collection() {
        return Collection.__super__.constructor.apply(this, arguments);
      }

      return Collection;

    })(Thorax.Collection);
  });

}).call(this);

/**
 * Backbone localStorage Adapter
 * Version 1.1.7
 *
 * https://github.com/jeromegn/Backbone.localStorage
 */
(function (root, factory) {
   if (typeof exports === 'object' && typeof require === 'function') {
     module.exports = factory(require("underscore"), require("backbone"));
   } else if (typeof define === "function" && define.amd) {
      // AMD. Register as an anonymous module.
      define('localstorage',["underscore","backbone"], function(_, Backbone) {
        // Use global variables if the locals are undefined.
        return factory(_ || root._, Backbone || root.Backbone);
      });
   } else {
      // RequireJS isn't being used. Assume underscore and backbone are loaded in <script> tags
      factory(_, Backbone);
   }
}(this, function(_, Backbone) {
// A simple module to replace `Backbone.sync` with *localStorage*-based
// persistence. Models are given GUIDS, and saved into a JSON object. Simple
// as that.

// Hold reference to Underscore.js and Backbone.js in the closure in order
// to make things work even if they are removed from the global namespace

// Generate four random hex digits.
function S4() {
   return (((1+Math.random())*0x10000)|0).toString(16).substring(1);
};

// Generate a pseudo-GUID by concatenating random hexadecimal.
function guid() {
   return (S4()+S4()+"-"+S4()+"-"+S4()+"-"+S4()+"-"+S4()+S4()+S4());
};

// Our Store is represented by a single JS object in *localStorage*. Create it
// with a meaningful name, like the name you'd give a table.
// window.Store is deprectated, use Backbone.LocalStorage instead
Backbone.LocalStorage = window.Store = function(name) {
  if( !this.localStorage ) {
    throw "Backbone.localStorage: Environment does not support localStorage."
  }
  this.name = name;
  var store = this.localStorage().getItem(this.name);
  this.records = (store && store.split(",")) || [];
};

_.extend(Backbone.LocalStorage.prototype, {

  // Save the current state of the **Store** to *localStorage*.
  save: function() {
    this.localStorage().setItem(this.name, this.records.join(","));
  },

  // Add a model, giving it a (hopefully)-unique GUID, if it doesn't already
  // have an id of it's own.
  create: function(model) {
    if (!model.id) {
      model.id = guid();
      model.set(model.idAttribute, model.id);
    }
    this.localStorage().setItem(this.name+"-"+model.id, JSON.stringify(model));
    this.records.push(model.id.toString());
    this.save();
    return this.find(model);
  },

  // Update a model by replacing its copy in `this.data`.
  update: function(model) {
    this.localStorage().setItem(this.name+"-"+model.id, JSON.stringify(model));
    if (!_.include(this.records, model.id.toString()))
      this.records.push(model.id.toString()); this.save();
    return this.find(model);
  },

  // Retrieve a model from `this.data` by id.
  find: function(model) {
    return this.jsonData(this.localStorage().getItem(this.name+"-"+model.id));
  },

  // Return the array of all models currently in storage.
  findAll: function() {
    // Lodash removed _#chain in v1.0.0-rc.1
    return (_.chain || _)(this.records)
      .map(function(id){
        return this.jsonData(this.localStorage().getItem(this.name+"-"+id));
      }, this)
      .compact()
      .value();
  },

  // Delete a model from `this.data`, returning it.
  destroy: function(model) {
    if (model.isNew())
      return false
    this.localStorage().removeItem(this.name+"-"+model.id);
    this.records = _.reject(this.records, function(id){
      return id === model.id.toString();
    });
    this.save();
    return model;
  },

  localStorage: function() {
    return localStorage;
  },

  // fix for "illegal access" error on Android when JSON.parse is passed null
  jsonData: function (data) {
      return data && JSON.parse(data);
  },

  // Clear localStorage for specific collection.
  _clear: function() {
    var local = this.localStorage(),
      itemRe = new RegExp("^" + this.name + "-");

    // Remove id-tracking item (e.g., "foo").
    local.removeItem(this.name);

    // Lodash removed _#chain in v1.0.0-rc.1
    // Match all data items (e.g., "foo-ID") and remove.
    (_.chain || _)(local).keys()
      .filter(function (k) { return itemRe.test(k); })
      .each(function (k) { local.removeItem(k); });

    this.records.length = 0;
  },

  // Size of localStorage.
  _storageSize: function() {
    return this.localStorage().length;
  }

});

// localSync delegate to the model or collection's
// *localStorage* property, which should be an instance of `Store`.
// window.Store.sync and Backbone.localSync is deprecated, use Backbone.LocalStorage.sync instead
Backbone.LocalStorage.sync = window.Store.sync = Backbone.localSync = function(method, model, options) {
  var store = model.localStorage || model.collection.localStorage;

  var resp, errorMessage, syncDfd = Backbone.$.Deferred && Backbone.$.Deferred(); //If $ is having Deferred - use it.

  try {

    switch (method) {
      case "read":
        resp = model.id != undefined ? store.find(model) : store.findAll();
        break;
      case "create":
        resp = store.create(model);
        break;
      case "update":
        resp = store.update(model);
        break;
      case "delete":
        resp = store.destroy(model);
        break;
    }

  } catch(error) {
    if (error.code === 22 && store._storageSize() === 0)
      errorMessage = "Private browsing is unsupported";
    else
      errorMessage = error.message;
  }

  if (resp) {
    if (options && options.success) {
      if (Backbone.VERSION === "0.9.10") {
        options.success(model, resp, options);
      } else {
        options.success(resp);
      }
    }
    if (syncDfd) {
      syncDfd.resolve(resp);
    }

  } else {
    errorMessage = errorMessage ? errorMessage
                                : "Record Not Found";

    if (options && options.error)
      if (Backbone.VERSION === "0.9.10") {
        options.error(model, errorMessage, options);
      } else {
        options.error(errorMessage);
      }

    if (syncDfd)
      syncDfd.reject(errorMessage);
  }

  // add compatibility with $.ajax
  // always execute callback for success and error
  if (options && options.complete) options.complete(resp);

  return syncDfd && syncDfd.promise();
};

Backbone.ajaxSync = Backbone.sync;

Backbone.getSyncMethod = function(model) {
  if(model.localStorage || (model.collection && model.collection.localStorage)) {
    return Backbone.localSync;
  }

  return Backbone.ajaxSync;
};

// Override 'Backbone.sync' to default to localSync,
// the original 'Backbone.sync' is still available in 'Backbone.ajaxSync'
Backbone.sync = function(method, model, options) {
  return Backbone.getSyncMethod(model).apply(this, [method, model, options]);
};

return Backbone.LocalStorage;
}));


(function() {

  define('cs!collections/grids',['cs!collection', 'cs!models/grid', 'cs!lib/messages', 'localstorage'], function(Collection, GridModel, Messages) {
    return Collection.extend({
      name: 'grids',
      model: GridModel,
      initialize: function(attributes, options) {
        var ns;
        if (attributes == null) {
          attributes = {};
        }
        if (options == null) {
          options = {};
        }
        ns = "" + (options.ns ? options.ns + '-' : '') + "guideguide-grids";
        this.localStorage = new Backbone.BridgeStorage(ns, Bridge.localStorage());
        this.defaultGrids = [
          {
            name: Messages.get('titleOutline'),
            notation: '| ~ | ( vl )\n| ~ | ( hl )'
          }, {
            name: '垂直数列',
            notation: '| 1% | 1% | 1% | 2% | 3% | 5% | 8% | 13% | 21% | 34% | ( vl )'
          }, {
            name: Messages.get('titleThreeColumnGrid'),
            form: {
              columnCount: '3'
            }
          }
        ];
        return this.fetch();
      },
      bootstrap: function() {
        var grid, _i, _len, _ref, _results;
        if (!this.isEmpty()) {
          return;
        }
        _ref = this.defaultGrids;
        _results = [];
        for (_i = 0, _len = _ref.length; _i < _len; _i++) {
          grid = _ref[_i];
          _results.push(this.create(new GridModel({}, {
            exSet: grid
          })));
        }
        return _results;
      },
      deleteAll: function() {
        var model, _results;
        _results = [];
        while (model = this.first()) {
          _results.push(model.destroy());
        }
        return _results;
      },
      deleteSelected: function() {
        return _.each(_.clone(this.getSelected()), function(model) {
          return model.destroy();
        });
      },
      getSelected: function() {
        return this.where({
          selected: true
        });
      }
    });
  });

}).call(this);


(function() {

  define('cs!views/saved-grids',['cs!collection-view', 'hbs!templates/savedgrids-item', 'hbs!templates/savedgrids-empty', 'cs!views/saved-grid', 'cs!lib/messages', 'cs!collections/grids'], function(CollectionView, itemTemplate, emptyTemplate, SavedGridView, Messages, GridCollection) {
    return CollectionView.extend({
      name: 'saved-grids',
      tagName: 'ul',
      itemTemplate: itemTemplate,
      itemView: SavedGridView,
      emptyTemplate: emptyTemplate,
      events: {
        'click .js-restore-defaults': 'onClickRestoreDefaults'
      },
      initialize: function(attributes, options) {
        if (attributes == null) {
          attributes = {};
        }
        if (options == null) {
          options = {};
        }
        this.msgBlankSlate = Messages.get('blankslateGrids');
        this.msgAddDefaultGrids = Messages.get('btnAddDefaultGrids');
        this.collection = new GridCollection(null, options);
        return this.listenTo(this, 'item:click', this.onItemClick);
      },
      onItemClick: function(item) {
        var _ref;
        return (_ref = this.parent) != null ? _ref.trigger('item:click', item) : void 0;
      },
      bootstrap: function() {
        return this.collection.bootstrap();
      },
      onClickRestoreDefaults: function(event) {
        event.preventDefault();
        return this.collection.bootstrap();
      },
      getSelected: function() {
        return this.collection.getSelected();
      },
      deleteSelected: function() {
        return this.collection.deleteSelected();
      }
    });
  });

}).call(this);


(function() {

  define('cs!views/saved',['cs!view', 'hbs!templates/saved', 'cs!lib/messages', 'cs!views/saved-grids', 'cs!views/footer'], function(View, template, Messages, CollectionView, FooterView, GuideGuide) {
    return View.extend({
      name: 'saved',
      template: template,
      initialize: function(attributes, options) {
        var bootstrapped;
        if (attributes == null) {
          attributes = {};
        }
        if (options == null) {
          options = {};
        }
        this.formButtons = {
          collection: [
            {
              label: Messages.get('btnAddGuides'),
              name: 'addGuides'
            }
          ],
          more: [
            {
              label: Messages.get('btnEditSelected'),
              name: 'edit',
              classes: 'is-disabled'
            }, {
              label: Messages.get('btnDeleteSelected'),
              name: 'delete',
              classes: 'is-disabled'
            }, {
              label: Messages.get('btnImport'),
              name: 'import'
            }, {
              label: Messages.get('btnExport'),
              name: 'export'
            }
          ]
        };
        if (this.app.capabilities.gridFromExisting) {
          this.formButtons.more.unshift({
            label: Messages.get('btnNewFromExisting'),
            name: 'existing'
          });
        }
        this.listenTo(this, 'item:click', this.onItemClick);
        this.grids = new CollectionView(null, options);
        this.msgUpsell = Messages.get('msgSavedUpsell');
        if (this.app.freeVersion) {
          this.footer = new FooterView({
            app: this.app,
            quickGuides: true,
            buttons: {
              collection: [
                {
                  label: Messages.get('btnLearnMore'),
                  name: 'buy'
                }
              ],
              more: [
                {
                  label: Messages.get('btnExport'),
                  name: 'export'
                }
              ]
            }
          });
        } else {
          this.footer = new FooterView({
            app: this.app,
            quickGuides: true,
            buttons: this.formButtons
          });
        }
        this.listenTo(this.footer, 'buttonClick', this.footerEventRouter);
        bootstrapped = Bridge.localStorage().getItem('ggHasBootstrappedGrids');
        if (bootstrapped !== 'true' && bootstrapped !== true) {
          this.grids.bootstrap();
          return Bridge.localStorage().setItem('ggHasBootstrappedGrids', true);
        }
      },
      footerEventRouter: function(button) {
        switch (button) {
          case 'addGuides':
            return this.addGuides(function(count) {
              return typeof ga === "function" ? ga('event', 'Saved', 'Add guides', count.toString()) : void 0;
            });
          case 'existing':
            this.trigger('newFromExisting');
            return typeof ga === "function" ? ga('event', 'Saved', 'New grid from existing guides') : void 0;
          case 'buy':
            this.parent.trigger('openUrl', this.parent.buyUrl);
            return typeof ga === "function" ? ga('event', 'Upsell', 'From saved') : void 0;
          case 'import':
            return this["import"]();
          case 'export':
            return this["export"]();
          case 'edit':
            return this.edit();
          case 'delete':
            return this["delete"]();
          default:
            return this.trigger('buttonClick', button);
        }
      },
      onItemClick: function(item) {
        this.footer.toggleButton('edit', this.grids.getSelected().length !== 1);
        return this.footer.toggleButton('delete', this.grids.getSelected().length < 1);
      },
      edit: function() {
        var model;
        model = this.grids.getSelected()[0];
        if (model.type() === 'custom') {
          return this.custom.showEditForm(model);
        }
        return this.form.showEditForm(model);
      },
      addGuides: function(callback) {
        var form, grid, grids, notations, str1, str2, _i, _len;
        grids = this.grids.getSelected();
        if (!grids.length) {
          return;
        }
        notations = [];
        for (_i = 0, _len = grids.length; _i < _len; _i++) {
          grid = grids[_i];
          if (grid.type() === 'custom') {
            notations.push(grid.get('notation'));
          } else {
            form = grid.get('form');
            str1 = GridNotation.stringify({
              count: form.columnCount,
              width: form.columnWidth,
              gutter: form.columnGutter,
              firstMargin: form.leftMargin,
              lastMargin: form.rightMargin,
              columnMidpoint: form.columnWidthSplit,
              gutterMidpoint: form.columnGutterSplit,
              orientation: 'v',
              position: form.verticalPosition,
              calculation: this.getSnapValue(),
              remainder: 'l'
            });
            str2 = GridNotation.stringify({
              count: form.rowCount,
              width: form.rowHeight,
              gutter: form.rowGutter,
              firstMargin: form.topMargin,
              lastMargin: form.bottomMargin,
              columnMidpoint: form.rowHeightSplit,
              gutterMidpoint: form.rowGutterSplit,
              orientation: 'h',
              position: form.horizontalPosition,
              calculation: this.getSnapValue(),
              remainder: 'l'
            });
            notations.push("" + (str1 || '') + (str1 && str2 ? '\n' : '') + (str2 || ''));
          }
        }
        if (notations.length) {
          this.trigger('addGuides', notations);
          if (callback) {
            return callback(notations.length);
          }
        }
      },
      getSnapValue: function() {
        return this.app.snap;
      },
      "delete": function() {
        return this.grids.deleteSelected();
      },
      "import": function() {
        return this.trigger('porter:show', 'import');
      },
      "export": function() {
        return this.trigger('porter:show', 'export');
      }
    });
  });

}).call(this);


(function() {

  define('cs!lib/grid-normalizer',[],function() {
    var GridNormalizer;
    GridNormalizer = function() {
      return {
        normalize: function(data) {
          switch (false) {
            case !this.isV4Format(data):
              return data;
            case !this.isV3Format(data):
              return this.normalizeV3(data);
            case !this.isV2Format(data):
              return this.normalizeV2(data);
          }
        },
        normalizeGist: function(gist) {
          var content;
          content = (gist.files['sets.json'] || gist.files['grids.json']).content;
          return JSON.parse(content) || null;
        },
        type: function(data) {
          var regex, _ref;
          regex = /\[object (.*?)\]/gi;
          return (_ref = regex.exec(Object.prototype.toString.call(data))[1]) != null ? _ref.toLowerCase() : void 0;
        },
        isV4Format: function(data) {
          return this.type(data) === 'array' && (data[0].form || data[0].notation);
        },
        isV3Format: function(data) {
          var _ref;
          return this.type(data) === 'object' && ((_ref = data['Default']) != null ? _ref.name : void 0) === 'Default';
        },
        isV2Format: function(data) {
          var _ref;
          return this.type(data) === 'array' && (((_ref = data[0]) != null ? _ref.colsWidth : void 0) != null);
        },
        normalizeV3: function(data) {
          var grid, k, _ref, _results;
          _ref = data['Default'].sets;
          _results = [];
          for (k in _ref) {
            grid = _ref[k];
            _results.push({
              name: grid.name,
              notation: grid.string
            });
          }
          return _results;
        },
        normalizeV2: function(data) {
          var grid, str1, str2, _i, _len, _results;
          _results = [];
          for (_i = 0, _len = data.length; _i < _len; _i++) {
            grid = data[_i];
            str1 = GridNotation.stringify({
              count: grid.colsCount,
              width: grid.colsWidth,
              gutter: grid.colsGutter,
              firstMargin: grid.margLeft,
              lastMargin: grid.margRight,
              orientation: 'v'
            });
            str2 = GridNotation.stringify({
              count: grid.rowsCount,
              width: grid.rowsWidth,
              gutter: grid.rowsGutter,
              firstMargin: grid.margTop,
              lastMargin: grid.margBottom,
              orientation: 'h'
            });
            _results.push({
              name: grid.name,
              notation: ("" + str1 + "\n" + str2).trim()
            });
          }
          return _results;
        }
      };
    };
    return new GridNormalizer();
  });

}).call(this);


(function() {

  define('cs!lib/guide',[],function() {
    var Guide;
    Guide = function() {
      return {
        toString: function(obj) {
          return "" + obj.orientation + ":" + obj.location;
        },
        toObject: function(string) {
          var arr;
          arr = /([hv]):(-?\d+)/.exec(string).slice(1, 3);
          return {
            orientation: arr[0],
            location: parseFloat(arr[1])
          };
        }
      };
    };
    return new Guide();
  });

}).call(this);


(function() {

  define('cs!views/guideguide',['cs!view', 'hbs!templates/guideguide', 'cs!lib/messages', 'cs!views/tabs', 'cs!views/alert', 'cs!views/porter', 'hbs!templates/icons', 'cs!views/form', 'cs!views/custom', 'cs!views/saved', 'cs!lib/grid-normalizer', 'cs!lib/guide'], function(View, template, Messages, TabsView, AlertView, PorterView, Icons, FormView, CustomView, SavedGridsView, Normalizer, Guide) {
    return View.extend({
      name: 'guideguide',
      className: 'guideguide theme-dark',
      template: template,
      buyUrl: 'http://guideguide.me/',
      app: {
        locale: 'en_us',
        snap: false,
        document: null,
        capabilities: {}
      },
      initialize: function(attributes, options) {
        if (attributes == null) {
          attributes = {};
        }
        if (options == null) {
          options = {};
        }
        Bridge.log('Starting up');
        this.initAttributes = _.extend({}, attributes);
        this.initOptions = _.extend({}, options);
        Bridge.use('syncAppInfo', this.syncAppInfo, this);
        Bridge.use('updateTheme', this.updateTheme, this);
        Bridge.use('alertAboutGA', this.alertAboutGA, this);
        Bridge.use('menuVersion', this.menuVersion, this);
        Bridge.use('start', this.start, this);
        Bridge.use('app', this.app);
        Bridge.use('Messages', Messages);
        this.app.bridge = Bridge;
        return Bridge.ready = true;
      },
      start: function() {
        var freeVersion, viewAttrs;
        Messages.locale = this.app.locale;
        Bridge.init();
        Bridge.log('Initializing GuideGuide');
        Bridge.log("  Using locale: " + this.app.locale);
        this.msgSaveYourGrid = Messages.get('titleSaveYourGrid');
        this.msgGistDescription = Messages.get('msgGistDescription');
        freeVersion = Bridge.freeVersion();
        this.app.freeVersion = freeVersion && this.app.trialExpired;
        Bridge.log("  Free version: " + freeVersion);
        Bridge.log("  Trial expired: " + this.app.trialExpired);
        viewAttrs = {
          parent: this,
          app: this.app,
          grids: this.initAttributes.grids
        };
        this.model = new Thorax.Model();
        Bridge.log('  Created main model view');
        this.tabs = new TabsView({
          app: this.app
        });
        this.listenTo(this.tabs, 'tab:click', this.onTabClick);
        this.listenTo(this.tabs, 'toggleGuides', this.toggleGuides);
        this.listenTo(this.tabs, 'openUrl', this.openUrl);
        Bridge.log('  Created tabs view');
        this.porter = new PorterView({
          app: this.app
        });
        this.listenTo(this.porter, 'import:gist', this.importGridsFromGist);
        this.listenTo(this.porter, 'import:file', this.importGridsFromFile);
        this.listenTo(this.porter, 'export:gist', this.exportGridsToGist);
        this.listenTo(this.porter, 'export:file', this.exportGridsToFile);
        Bridge.log('  Created porter view');
        this.formView = new FormView(viewAttrs, {
          ns: this.initOptions.ns
        });
        this.listenTo(this.formView, 'addGuides', this.addGuides);
        this.listenTo(this.formView, 'edit:enable', this.onEdit);
        this.listenTo(this.formView, 'edit:disable', this.onEditDisable);
        this.listenTo(this.formView, 'save', this.onSaveGrid);
        this.listenTo(this.formView, 'buttonClick', this.quickActionRouter);
        this.listenTo(this.formView, 'refreshCustom', this.onFormUpdate);
        this.listenTo(this.formView, 'input:focused', this.onInputFocus);
        Bridge.log('  Created form view');
        this.customView = new CustomView(viewAttrs, {
          ns: this.initOptions.ns
        });
        this.listenTo(this.customView, 'addGuides', this.addGuides);
        this.listenTo(this.customView, 'edit:enable', this.onEdit);
        this.listenTo(this.customView, 'edit:disable', this.onEditDisable);
        this.listenTo(this.customView, 'save', this.onSaveGrid);
        this.listenTo(this.customView, 'buttonClick', this.quickActionRouter);
        Bridge.log('  Created custom form view');
        this.alert = new AlertView();
        this.listenTo(this.alert, 'buttonClick', this.alertRouter);
        Bridge.log('  Created alert view');
        if (this.app.localStorage) {
          this.savedGrids = new SavedGridsView({
            form: this.formView,
            app: this.app,
            custom: this.customView
          }, this.initOptions);
          this.grids = this.savedGrids.grids.collection;
          this.listenTo(this.savedGrids, 'porter:show', this.onPorterShow);
          this.listenTo(this.savedGrids, 'buttonClick', this.quickActionRouter);
          this.listenTo(this.savedGrids, 'newFromExisting', this.saveGridFromExisting);
          this.listenTo(this.savedGrids, 'addGuides', this.addGuides);
          Bridge.log('  Created saved view');
        }
        this.listenTo(this, 'openUrl', this.openUrl);
        Bridge.log('  Listening to url open events');
        this.render();
        Bridge.log('  Rendered the main view');
        this.$el.addClass('is-visible');
        Bridge.log('  Revealed the UI');
        if (typeof ga === "function") {
          ga('pageview');
        }
        this.alertAboutGA();
        this.alertAboutFreeVersionEnabled();
        this.phoneHome();
        return Bridge.log('GuideGuide is ready');
      },
      alertAboutFreeVersionEnabled: function() {
        if (!this.app.freeVersion) {
          return;
        }
        return this.alert.push({
          title: Messages.get('titleFreeVersion'),
          message: Messages.get('msgFreeVersionEnabled'),
          buttons: [
            {
              label: Messages.get('btnOk'),
              name: 'freeVersionEnabled'
            }, {
              label: Messages.get('btnLearnMore'),
              name: 'freeLearnMore'
            }
          ]
        });
      },
      phoneHome: function() {
        var head, script,
          _this = this;
        window.handleJSONP = function(data) {
          return _this.onPhonedHome.apply(_this, arguments);
        };
        script = document.createElement('script');
        head = document.getElementsByTagName('head')[0];
        script.src = this.dataset('checkinPath') + 'checkin.json?callback=handleJSONP&cachekey=' + Math.random();
        return head.appendChild(script);
      },
      onPhonedHome: function(data) {
        this.upgradeURL = data.upgradeURL;
        if (Bridge.localStorage().getItem('askedToUpgrade') == null) {
          return this.alertAboutUpgrade();
        }
      },
      dataset: function(key) {
        return document.getElementsByTagName('body')[0].dataset[key];
      },
      alertAboutUpgrade: function() {
        var edition, otherApp;
        if (!window.isNotDemo) {
          return;
        }
        if (!(this.app.usageCount > 30)) {
          return;
        }
        if (!(edition = this.dataset('edition').match(/^(ps|ai)$/))) {
          return;
        }
        otherApp = edition[1] === 'ps' ? 'Illustrator' : 'Photoshop';
        return this.alert.push({
          title: Messages.get('titleUpgradeToTheBundle', otherApp),
          message: Messages.get('msgUpgradeToTheBundle', otherApp),
          buttons: [
            {
              label: Messages.get('btnLearnMore'),
              name: 'upgradeLearn'
            }, {
              label: Messages.get('btnNo'),
              name: 'upgradeNo'
            }
          ]
        });
      },
      alertAboutGA: function(force) {
        if (force == null) {
          force = false;
        }
        if (typeof ga === "undefined" || ga === null) {
          return;
        }
        if ((Bridge.localStorage().getItem('ggGAOK') != null) && !force) {
          return;
        }
        return this.alert.push({
          title: Messages.get('titleGoogleAnalytics'),
          message: Messages.get('msgGoogleAnalytics'),
          buttons: [
            {
              label: Messages.get('btnYes'),
              name: 'gaConfirm'
            }, {
              label: Messages.get('btnNo'),
              name: 'gaDeny'
            }
          ]
        });
      },
      updateTheme: function() {
        this.$el.removeClass('theme-lighter theme-light theme-dark theme-darker');
        return this.$el.addClass(this.app.themeClass);
      },
      openUrl: function(url) {
        return Bridge.openUrl(url);
      },
      syncAppInfo: function(obj) {
        var k, v, _results;
        if (obj == null) {
          return null;
        }
        _results = [];
        for (k in obj) {
          v = obj[k];
          _results.push(this.app[k] = v);
        }
        return _results;
      },
      addGuides: function(gn, useSelectedLayer) {
        if (useSelectedLayer == null) {
          useSelectedLayer = false;
        }
        return Bridge.hasOpenDocument(function(doc) {
          var fetchContexts;
          doc = JSON.parse(doc);
          if (!doc) {
            return;
          }
          fetchContexts = useSelectedLayer ? function(callback) {
            return Bridge.exec('getSelectedLayerContexts', function(err, contexts) {
              return callback(contexts || {});
            });
          } : function(callback) {
            return Bridge.getContexts(callback);
          };
          return fetchContexts(function(contexts) {
            var context, guides, key, notation, options, res, _i, _len;
            res = {};
            for (key in contexts) {
              context = contexts[key];
              options = _.extend(context);
              options.resolution = doc.resolution || 72;
              if (typeof gn === 'string') {
                gn = [gn];
              }
              guides = [];
              for (_i = 0, _len = gn.length; _i < _len; _i++) {
                notation = gn[_i];
                guides = _.union(guides, GridNotation.parse(notation, options));
              }
              res[key] = _.uniq(_.map(guides, function(g) {
                return Guide.toString(g);
              }));
            }
            if (!_.isEmpty(res)) {
              return Bridge.exec('addGuides', res);
            }
          });
        });
      },
      hasOpenDocument: function(callback) {
        return Bridge.hasOpenDocument(callback);
      },
      clearGuides: function() {
        return Bridge.hasOpenDocument(function(hasOpenDocument) {
          if (!hasOpenDocument) {
            return;
          }
          return Bridge.exec('clearGuides');
        });
      },
      consolidateGuides: function(existing, added, args) {
        var e, i, inBounds, include, list, result, _ref, _ref1;
        if (args == null) {
          args = {};
        }
        list = {};
        result = [];
        for (i in existing) {
          e = existing[i];
          list["" + e.location + "." + e.orientation] = true;
        }
        for (i in added) {
          e = added[i];
          include = list["" + e.location + "." + e.orientation] == null;
          list["" + e.location + "." + e.orientation] = true;
          if (args.bounds && include) {
            inBounds = false;
            if (e.orientation === "h" && (args.bounds.bottom >= (_ref = e.location) && _ref >= args.bounds.top)) {
              inBounds = true;
            }
            if (e.orientation === "v" && (args.bounds.right >= (_ref1 = e.location) && _ref1 >= args.bounds.left)) {
              inBounds = true;
            }
            if ((inBounds && args.invert) || (!inBounds && !args.invert)) {
              include = false;
            }
          }
          if (include) {
            result.push(e);
          }
        }
        return result;
      },
      onTabClick: function(id) {
        var $pages;
        $pages = this.$(".js-tabbed-pages > [data-tab]");
        $pages.removeClass('is-active');
        return $pages.filter("[data-tab=" + id + "]").addClass('is-active');
      },
      toggleGuides: function() {
        return Bridge.exec('toggleGuides');
      },
      onFormUpdate: function(gn) {
        if (this.app.freeVersion) {
          return;
        }
        return this.customView.prefillForm(gn);
      },
      onInputFocus: function() {
        var _this = this;
        return Bridge.getDocumentRulerUnits(function(units) {
          if (_this.app.document != null) {
            return _this.app.document.ruler = units;
          }
        });
      },
      onEdit: function(form) {
        this.$('.js-header-title').addClass('is-showing').find('span').text(this.msgSaveYourGrid);
        this.tabs.toggleTitle(true);
        this.$("[data-tab=" + form + "]").click();
        return this.editorForm = this.$("[data-tab].is-active").attr('data-tab');
      },
      onEditDisable: function() {
        this.$('.js-header-title').removeClass('is-showing').find('span').text('');
        this.tabs.toggleTitle(false);
        return this.$("[data-tab=" + this.editorForm + "]").click();
      },
      onSaveGrid: function(model) {
        this.savedGrids.grids.collection.create(model, {
          merge: true
        });
        this.formView.hideEditForm();
        this.customView.hideEditForm();
        return this.$('[data-tab=saved]').click();
      },
      saveGridFromExisting: function() {
        var _this = this;
        return Bridge.hasOpenDocument(function(hasOpenDocument) {
          if (!hasOpenDocument) {
            return;
          }
          return Bridge.getExistingGuides(function(guides) {
            var guide, prevHorizontal, prevVertical, string, xString, yString, _i, _len;
            if (!guides) {
              return;
            }
            xString = '';
            yString = '';
            string = '';
            prevHorizontal = 0;
            prevVertical = 0;
            for (_i = 0, _len = guides.length; _i < _len; _i++) {
              guide = guides[_i];
              guide = Guide.toObject(guide);
              if (guide.orientation === 'v') {
                xString = "" + xString + (guide.location - prevVertical) + "px | ";
                prevVertical = guide.location;
              }
              if (guide.orientation === 'h') {
                yString = "" + yString + (guide.location - prevHorizontal) + "px | ";
                prevHorizontal = guide.location;
              }
            }
            if (xString !== '') {
              xString = "" + xString + "(v" + (_this.app.snap ? 'p' : void 0) + ")";
            }
            if (yString !== '') {
              yString = "" + yString + "(h" + (_this.app.snap ? 'p' : void 0) + ")";
            }
            string += xString;
            if (xString) {
              string += '\n';
            }
            string += yString;
            if (yString) {
              string += '\n';
            }
            _this.customView.showEditForm();
            return _this.customView.prefillForm(string, _this.customView.captureFormData().name);
          });
        });
      },
      onPorterShow: function(tab) {
        return this.porter.show(tab);
      },
      importGrids: function(grids) {
        var grid, _i, _len, _results;
        _results = [];
        for (_i = 0, _len = grids.length; _i < _len; _i++) {
          grid = grids[_i];
          _results.push(this.grids.create(grid));
        }
        return _results;
      },
      importGridsFromGist: function(gist) {
        var _this = this;
        return $.ajax({
          url: "https://api.github.com/gists/" + gist,
          type: 'GET',
          error: function(xhr) {
            return _this.porter.error(xhr.responseText);
          },
          success: function(data) {
            var grids;
            grids = Normalizer.normalizeGist(data);
            _this.importGrids(Normalizer.normalize(grids));
            _this.porter.hide();
            return typeof ga === "function" ? ga('event', 'Utilities', 'Import', 'gist') : void 0;
          }
        });
      },
      fetchExportContents: function() {
        var selected;
        selected = this.grids.getSelected();
        if (!selected.length) {
          selected = this.grids.models;
        }
        return _.map(selected, function(grid) {
          return _.omit(grid.attributes, ['id', 'selected']);
        });
      },
      exportGridsToGist: function() {
        var grids,
          _this = this;
        grids = this.fetchExportContents();
        if (!grids.length) {
          return;
        }
        return $.ajax({
          url: "https://api.github.com/gists",
          type: 'POST',
          data: JSON.stringify({
            description: this.msgGistDescription,
            "public": false,
            files: {
              "grids.json": {
                content: JSON.stringify(grids)
              }
            }
          }),
          error: function(xhr) {
            return _this.porter.error(xhr.responseText);
          },
          success: function(data) {
            _this.openUrl(data.html_url);
            _this.porter.hide();
            return typeof ga === "function" ? ga('event', 'Utilities', 'Export', 'gist') : void 0;
          }
        });
      },
      importGridsFromFile: function() {
        var _this = this;
        return Bridge.readFile(function(err, file) {
          var grids;
          if (err === 'notJSON') {
            return _this.porter.error(Messages.get("errNotJSON"));
          }
          if (err === 'fileError') {
            return _this.porter.error(Messages.get("errFileRead"));
          }
          grids = JSON.parse(file);
          _this.importGrids(Normalizer.normalize(grids));
          _this.porter.hide();
          return typeof ga === "function" ? ga('event', 'Utilities', 'Import', 'file') : void 0;
        });
      },
      exportGridsToFile: function() {
        var grids,
          _this = this;
        grids = this.fetchExportContents();
        if (!grids.length) {
          return;
        }
        Bridge.writeFile('grids.json', JSON.stringify(grids), function(err) {
          if (err === 'canceled') {
            return;
          }
          if (err) {
            return _this.alert.push({
              title: Messages.get('titleExportError'),
              message: err
            });
          }
          return _this.porter.hide();
        });
        return typeof ga === "function" ? ga('event', 'Utilities', 'Export', 'file') : void 0;
      },
      alertRouter: function(action) {
        switch (action) {
          case 'gaConfirm':
            return Bridge.localStorage().setItem('ggGAOK', true);
          case 'gaDeny':
            return Bridge.localStorage().setItem('ggGAOK', false);
          case 'freeLearnMore':
            this.openUrl(this.buyUrl);
            return typeof ga === "function" ? ga('event', 'Upsell', 'From free mode alert') : void 0;
          case 'upgradeLearn':
            this.openUrl(this.upgradeURL);
            Bridge.localStorage().setItem('askedToUpgrade', true);
            return typeof ga === "function" ? ga('event', 'Upgrade', 'From upgrade alert') : void 0;
          case 'upgradeNo':
            Bridge.localStorage().setItem('askedToUpgrade', true);
            return typeof ga === "function" ? ga('event', 'Decline', 'From upgrade alert') : void 0;
        }
      },
      quickActionRouter: function(action) {
        var pixel;
        pixel = !this.app.freeVersion && this.app.snap ? 'p' : '';
        switch (action) {
          case 'quickClear':
            this.clearGuides();
            break;
          case 'quickVFirst':
            this.addGuides("| ~ (v" + pixel + ")", true);
            break;
          case 'quickVLast':
            this.addGuides("~ | (v" + pixel + ")", true);
            break;
          case 'quickHFirst':
            this.addGuides("| ~ (h" + pixel + ")", true);
            break;
          case 'quickHLast':
            this.addGuides("~ | (h" + pixel + ")", true);
            break;
          case 'quickVCenter':
            this.addGuides("~ | ~ (v" + pixel + ")", true);
            break;
          case 'quickHCenter':
            this.addGuides("~ | ~ (h" + pixel + ")", true);
        }
        if (/quick/gi.test(action)) {
          return typeof ga === "function" ? ga('event', 'Quick', action.replace('quick', '')) : void 0;
        }
      }
    });
  });

}).call(this);


(function() {

  define('cs!routers/GuideGuide',["backbone", "cs!views/root", 'cs!views/guideguide'], function(Backbone, RootView, GuideGuideView) {
    return Backbone.Router.extend({
      routes: {
        "": "index"
      },
      index: function() {
        var view;
        view = new GuideGuideView();
        return RootView.getInstance().setView(view);
      }
    });
  });

}).call(this);


(function() {
  var __slice = [].slice;

  define('cs!lib/bridge',[],function() {
    var Bridge, bridge,
      _this = this;
    Bridge = (function() {

      Bridge.prototype.ready = false;

      Bridge.prototype.initTasks = [];

      function Bridge(data) {
        var _this = this;
        this.error = function(msg, url, line) {
          return Bridge.prototype.error.apply(_this, arguments);
        };
        this.ga = function(type, category, action, label, value) {
          return Bridge.prototype.ga.apply(_this, arguments);
        };
      }

      Bridge.prototype.init = function() {
        var ggGAOK, ns;
        this.log('Initializing Bridge');
        window.ga = this.ga;
        this.log('  Attached Google Analytics object');
        window.onerror = this.error;
        this.log('  Attached bridge error handler');
        ggGAOK = this.localStorage().getItem('ggGAOK');
        if (ggGAOK === 'true') {
          ggGAOK = true;
        }
        window.ggGAOK = ggGAOK ? true : false;
        if (typeof mocha !== "undefined" && mocha !== null) {
          window.ggGAOK = false;
        }
        this.log("  Ok to send analytics: " + window.ggGAOK);
        while (this.initTasks.length > 0) {
          this.initTasks.shift()();
        }
        this.log('  Completed bridge startup tasks');
        ns = 'ggGAGUID';
        window[ns] = this.localStorage().getItem(ns);
        if (window[ns] != null) {
          this.log('  Found GUID');
        }
        if (window[ns]) {
          return;
        }
        window[ns] = this.guid();
        this.localStorage().setItem(ns, window[ns]);
        return this.log('  Generated new GUID');
      };

      Bridge.prototype.guideguideVersion = function() {
        return $('body').attr('data-guideguide-version');
      };

      Bridge.prototype.freeVersion = function() {
        return $('body').attr('data-free') === 'false';
      };

      Bridge.prototype.guid = function() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
          var r, v;
          r = Math.random() * 16 | 0;
          v = c === 'x' ? r : r & 0x3 | 0x8;
          return v.toString(16);
        });
      };

      Bridge.prototype.ga = function(type, category, action, label, value) {
        var appSupport, body, ggVersion, key, obj, payLevel, url, xhr;
        if (!window.ggGAOK) {
          return;
        }
        body = document.getElementsByTagName('body')[0];
        ggVersion = body.dataset['guideguideVersion'];
        switch (body.dataset['free']) {
          case 'false':
            payLevel = 'full';
            break;
          case 'true':
            payLevel = 'trial';
            if (this.localStorage().getItem('ggTrialEnded') === 'true') {
              payLevel = 'free';
            }
            break;
          default:
            payLevel = body.dataset['free'];
        }
        switch (body.dataset['appSupport']) {
          case 'ps':
            appSupport = "Photoshop";
            break;
          case 'ai':
            appSupport = "Illustrator";
            break;
          default:
            appSupport = "Photoshop and Illustrator";
        }
        if (typeof isNotDemo === "undefined" || isNotDemo === null) {
          payLevel = 'demo';
        }
        obj = {
          v: 1,
          tid: body.dataset['tracker'],
          aip: 1,
          cid: window['ggGAGUID'],
          cm: appSupport,
          t: type,
          cd1: payLevel,
          cd3: this.getAppVersion(),
          cd4: ggVersion,
          cd5: appSupport
        };
        if (obj.cd3 !== 'Web') {
          obj.ul = this.getLocale().replace('_', '-');
        }
        if (type === 'pageview') {
          obj.dp = '%2F';
        }
        if (type === 'event') {
          obj.ec = category;
          obj.ea = action;
          if (label) {
            obj.el = label;
          }
          if (value) {
            obj.ev = value;
          }
        }
        url = 'http://www.google-analytics.com/collect?';
        for (key in obj) {
          value = obj[key];
          url += '&' + key + '=' + encodeURI(obj[key]);
        }
        url = url.replace('?&', '?');
        this.log('Sending analytics', "  " + url);
        xhr = new XMLHttpRequest();
        xhr.open('POST', url);
        return xhr.send(null);
      };

      Bridge.prototype.error = function(msg, url, line) {
        ga('event', 'Error', msg, url + ':' + line);
        this.log('', 'Error', msg, url + ':' + line, '');
        return false;
      };

      Bridge.prototype.use = function(key, val, ths) {
        if (typeof val === 'function') {
          return this[key] = val.bind(ths || this);
        } else {
          return this[key] = val;
        }
      };

      Bridge.prototype.start = function() {
        return this.log('Started GuideGuide');
      };

      Bridge.prototype.syncAppInfo = function(obj) {
        return this.log("Syncing app:", obj);
      };

      Bridge.prototype.fetchAndSyncAppInfo = function(callback) {
        var _this = this;
        return this.exec('getAppInfo', function(err, info) {
          _this.syncAppInfo(info);
          if (callback) {
            return callback();
          }
        });
      };

      Bridge.prototype.hasOpenDocument = function(callback) {
        return this.exec('hasOpenDocument', function(err, res) {
          if (callback) {
            return callback(res);
          }
        });
      };

      Bridge.prototype.changeTrackingSettings = function() {
        return this.alertAboutGA(true);
      };

      Bridge.prototype.getDocumentRulerUnits = function(callback) {
        return callback('px');
      };

      Bridge.prototype.openUrl = function(url) {
        return this.log("Opening", url);
      };

      Bridge.prototype.writeFile = function(filename, data, callback) {
        return this.log("Writing to: " + filename, data);
      };

      Bridge.prototype.readFile = function(callback) {
        var $select;
        this.log("Selecting a file");
        $select = $('<input type="file" />');
        $select.click();
        return $select.change(function() {
          return callback(null);
        });
      };

      Bridge.prototype.exec = function(method, data, callback) {
        var json, result;
        if (typeof arguments[1] === 'function') {
          callback = arguments[1];
          data = null;
        }
        result = this.host(method, data);
        json = result != null ? JSON.parse(result) : null;
        if (callback != null) {
          return callback(null, json);
        }
      };

      Bridge.prototype.getContexts = function(callback) {
        return this.exec('getContexts', function(err, rects) {
          if (callback) {
            return callback(rects);
          }
        });
      };

      Bridge.prototype.getExistingGuides = function(callback) {
        return this.exec('getExistingGuides', function(err, guides) {
          if (callback) {
            return callback(guides);
          }
        });
      };

      Bridge.prototype.getLocale = function() {
        return 'en_us';
      };

      Bridge.prototype.getAppVersion = function() {
        return 'Web';
      };

      Bridge.prototype.log = function() {
        var strings;
        strings = 1 <= arguments.length ? __slice.call(arguments, 0) : [];
        return typeof console !== "undefined" && console !== null ? console.log.apply(console, strings) : void 0;
      };

      Bridge.prototype.host = function(method, data) {
        var messages, result;
        messages = ["Called " + method + "()"];
        if (data != null) {
          messages[0] = "" + messages[0] + " with ";
          messages.push(data);
        }
        this.log.apply(this, messages);
        if (this[method] != null) {
          result = this[method](data);
        }
        if (result != null) {
          return JSON.stringify(result);
        } else {
          return null;
        }
      };

      Bridge.prototype.localStorage = function() {
        return {
          getItem: function(k) {
            return localStorage.getItem(k);
          },
          setItem: function(k, v) {
            return localStorage.setItem(k, v);
          },
          removeItem: function(k) {
            return localStorage.removeItem(k);
          }
        };
      };

      return Bridge;

    })();
    bridge = new Bridge();
    window.Bridge = bridge;
    return bridge;
  });

}).call(this);

/**
 * Backbone localStorage Adapter
 * Version 1.1.16
 *
 * https://github.com/jeromegn/Backbone.localStorage
 */
(function (root, factory) {
  if (typeof exports === 'object' && typeof require === 'function') {
    module.exports = factory(require("backbone"));
  } else if (typeof define === "function" && define.amd) {
    // AMD. Register as an anonymous module.
    define('lib/backbone.bridgeStorage',["backbone"], function(Backbone) {
      // Use global variables if the locals are undefined.
      return factory(Backbone || root.Backbone);
    });
  } else {
    factory(Backbone);
  }
}(this, function(Backbone) {
// A simple module to replace `Backbone.sync` with *localStorage*-based
// persistence. Models are given GUIDS, and saved into a JSON object. Simple
// as that.

// Generate four random hex digits.
function S4() {
   return (((1+Math.random())*0x10000)|0).toString(16).substring(1);
};

// Generate a pseudo-GUID by concatenating random hexadecimal.
function guid() {
   return (S4()+S4()+"-"+S4()+"-"+S4()+"-"+S4()+"-"+S4()+S4()+S4());
};

function isObject(item) {
  return item === Object(item);
}

function contains(array, item) {
  var i = array.length;
  while (i--) if (array[i] === item) return true;
  return false;
}

function extend(obj, props) {
  for (var key in props) obj[key] = props[key]
  return obj;
}

function result(object, property) {
    if (object == null) return void 0;
    var value = object[property];
    return (typeof value === 'function') ? object[property]() : value;
}

// Our Store is represented by a single JS object in *localStorage*. Create it
// with a meaningful name, like the name you'd give a table.
// window.Store is deprectated, use Backbone.BridgeStorage instead
Backbone.BridgeStorage = window.Store = function(name, bridgeStorage, serializer) {
  if( !this.localStorage ) {
    throw "Backbone.localStorage: Environment does not support localStorage."
  }
  this.name = name;
  this.bridgeStorage = bridgeStorage;
  this.serializer = serializer || {
    serialize: function(item) {
      return isObject(item) ? JSON.stringify(item) : item;
    },
    // fix for "illegal access" error on Android when JSON.parse is passed null
    deserialize: function (data) {
      return data && JSON.parse(data);
    }
  };
  var store = this.localStorage().getItem(this.name);
  this.records = (store && store.split(",")) || [];
};

extend(Backbone.BridgeStorage.prototype, {

  // Save the current state of the **Store** to *localStorage*.
  save: function() {
    this.localStorage().setItem(this.name, this.records.join(","));
  },

  // Add a model, giving it a (hopefully)-unique GUID, if it doesn't already
  // have an id of it's own.
  create: function(model) {
    if (!model.id && model.id !== 0) {
      model.id = guid();
      model.set(model.idAttribute, model.id);
    }
    this.localStorage().setItem(this._itemName(model.id), this.serializer.serialize(model));
    this.records.push(model.id.toString());
    this.save();
    return this.find(model);
  },

  // Update a model by replacing its copy in `this.data`.
  update: function(model) {
    this.localStorage().setItem(this._itemName(model.id), this.serializer.serialize(model));
    var modelId = model.id.toString();
    if (!contains(this.records, modelId)) {
      this.records.push(modelId);
      this.save();
    }
    return this.find(model);
  },

  // Retrieve a model from `this.data` by id.
  find: function(model) {
    return this.serializer.deserialize(this.localStorage().getItem(this._itemName(model.id)));
  },

  // Return the array of all models currently in storage.
  findAll: function() {
    var result = [];
    for (var i = 0, id, data; i < this.records.length; i++) {
      id = this.records[i];
      data = this.serializer.deserialize(this.localStorage().getItem(this._itemName(id)));
      if (data != null) result.push(data);
    }
    return result;
  },

  // Delete a model from `this.data`, returning it.
  destroy: function(model) {
    this.localStorage().removeItem(this._itemName(model.id));
    var modelId = model.id.toString();
    for (var i = 0, id; i < this.records.length; i++) {
      if (this.records[i] === modelId) {
        this.records.splice(i, 1);
      }
    }
    this.save();
    return model;
  },

  localStorage: function() {
    return this.bridgeStorage;
  },

  // Clear localStorage for specific collection.
  _clear: function() {
    var local = this.localStorage(),
      itemRe = new RegExp("^" + this.name + "-");

    // Remove id-tracking item (e.g., "foo").
    local.removeItem(this.name);

    // Match all data items (e.g., "foo-ID") and remove.
    for (var k in local) {
      if (itemRe.test(k)) {
        local.removeItem(k);
      }
    }

    this.records.length = 0;
  },

  // Size of localStorage.
  _storageSize: function() {
    return this.localStorage().length;
  },

  _itemName: function(id) {
    return this.name+"-"+id;
  }

});

// localSync delegate to the model or collection's
// *localStorage* property, which should be an instance of `Store`.
// window.Store.sync and Backbone.localSync is deprecated, use Backbone.BridgeStorage.sync instead
Backbone.BridgeStorage.sync = window.Store.sync = Backbone.localSync = function(method, model, options) {
  var store = result(model, 'localStorage') || result(model.collection, 'localStorage');

  var resp, errorMessage;
  //If $ is having Deferred - use it.
  var syncDfd = Backbone.$ ?
    (Backbone.$.Deferred && Backbone.$.Deferred()) :
    (Backbone.Deferred && Backbone.Deferred());

  try {

    switch (method) {
      case "read":
        resp = model.id != undefined ? store.find(model) : store.findAll();
        break;
      case "create":
        resp = store.create(model);
        break;
      case "update":
        resp = store.update(model);
        break;
      case "delete":
        resp = store.destroy(model);
        break;
    }

  } catch(error) {
    if (error.code === 22 && store._storageSize() === 0)
      errorMessage = "Private browsing is unsupported";
    else
      errorMessage = error.message;
  }

  if (resp) {
    if (options && options.success) {
      if (Backbone.VERSION === "0.9.10") {
        options.success(model, resp, options);
      } else {
        options.success(resp);
      }
    }
    if (syncDfd) {
      syncDfd.resolve(resp);
    }

  } else {
    errorMessage = errorMessage ? errorMessage
                                : "Record Not Found";

    if (options && options.error)
      if (Backbone.VERSION === "0.9.10") {
        options.error(model, errorMessage, options);
      } else {
        options.error(errorMessage);
      }

    if (syncDfd)
      syncDfd.reject(errorMessage);
  }

  // add compatibility with $.ajax
  // always execute callback for success and error
  if (options && options.complete) options.complete(resp);

  return syncDfd && syncDfd.promise();
};

Backbone.ajaxSync = Backbone.sync;

Backbone.getSyncMethod = function(model, options) {
  var forceAjaxSync = options && options.ajaxSync;

  if(!forceAjaxSync && (result(model, 'localStorage') || result(model.collection, 'localStorage'))) {
    return Backbone.localSync;
  }

  return Backbone.ajaxSync;
};

// Override 'Backbone.sync' to default to localSync,
// the original 'Backbone.sync' is still available in 'Backbone.ajaxSync'
Backbone.sync = function(method, model, options) {
  return Backbone.getSyncMethod(model, options).apply(this, [method, model, options]);
};

return Backbone.BridgeStorage;
}));

// Generated by CoffeeScript 1.10.0
(function() {
  var Command, GridNotation, Unit, error, find, lengthOf, trim,
    bind = function(fn, me){ return function(){ return fn.apply(me, arguments); }; };

  GridNotation = (function() {
    function GridNotation(args) {
      if (args == null) {
        args = {};
      }
      this.stringifyParams = bind(this.stringifyParams, this);
      this.stringifyCommands = bind(this.stringifyCommands, this);
      this.parseVariable = bind(this.parseVariable, this);
      this.parseParams = bind(this.parseParams, this);
      this.parseGrid = bind(this.parseGrid, this);
      this.isCommands = bind(this.isCommands, this);
      this.validate = bind(this.validate, this);
      this.objectify = bind(this.objectify, this);
      this.test = bind(this.test, this);
      this.stringify = bind(this.stringify, this);
      this.clean = bind(this.clean, this);
      this.unit = new Unit();
      this.cmd = new Command();
    }

    GridNotation.prototype.parse = function(string, info) {
      var adjust, adjustRemainder, command, explicit, explicitSum, fill, fillCollection, fillIterations, fillWidth, gn, grid, guideOrientation, guides, i, insertMarker, j, k, key, l, len, len1, len2, len3, len4, len5, len6, len7, len8, length, m, measuredWidth, n, newCommand, newCommands, o, offset, originalWidth, p, percentValue, percents, q, r, ref, ref1, ref10, ref11, ref12, ref13, ref14, ref15, ref16, ref17, ref18, ref19, ref2, ref20, ref21, ref22, ref23, ref24, ref25, ref26, ref27, ref3, ref4, ref5, ref6, ref7, ref8, ref9, remainderOffset, remainderPixels, s, stretchDivisions, t, tested, v, variable, wholePixels, wildcardArea, wildcardWidth, wildcards;
      if (string == null) {
        string = "";
      }
      if (info == null) {
        info = {};
      }
      if (info.resolution) {
        this.unit.resolution = info.resolution;
      }
      this.cmd.unit = this.unit;
      guides = [];
      tested = this.validate(this.objectify(string));
      if (tested.errors.length > 0) {
        return null;
      }
      gn = tested.obj;
      ref = gn.variables;
      for (key in ref) {
        variable = ref[key];
        gn.variables[key] = this.expandCommands(variable, {
          variables: gn.variables
        });
      }
      ref1 = gn.grids;
      for (j = 0, len = ref1.length; j < len; j++) {
        grid = ref1[j];
        guideOrientation = grid.params.orientation;
        wholePixels = grid.params.calculation === 'p';
        fill = find(grid.commands, function(el) {
          return el.isFill;
        })[0] || null;
        originalWidth = guideOrientation === 'h' ? info.height : info.width;
        measuredWidth = guideOrientation === 'h' ? info.height : info.width;
        if ((ref2 = grid.params.width) != null ? (ref3 = ref2.unit) != null ? ref3.base : void 0 : void 0) {
          measuredWidth = grid.params.width.unit.base;
        }
        offset = guideOrientation === 'h' ? info.offsetY : info.offsetX;
        stretchDivisions = 0;
        adjustRemainder = 0;
        wildcardArea = measuredWidth;
        grid.commands = this.expandCommands(grid.commands, gn.variables);
        wildcards = find(grid.commands, function(el) {
          return el.isWildcard;
        });
        if ((ref4 = grid.params.width) != null ? (ref5 = ref4.unit) != null ? ref5.base : void 0 : void 0) {
          adjustRemainder = originalWidth - ((ref6 = grid.params.width) != null ? ref6.unit.base : void 0);
        }
        percents = find(grid.commands, function(el) {
          return el.isPercent;
        });
        ref7 = gn.variables;
        for (k in ref7) {
          v = ref7[k];
          percents = percents.concat(find(v, function(el) {
            return el.isPercent;
          }));
        }
        for (l = 0, len1 = percents.length; l < len1; l++) {
          command = percents[l];
          percentValue = measuredWidth * (command.unit.value / 100);
          if (wholePixels) {
            percentValue = Math.floor(percentValue);
          }
          command.unit = this.unit.parse(percentValue + "px");
        }
        explicit = find(grid.commands, function(el) {
          return el.isExplicit && !el.isFill;
        });
        explicitSum = 0;
        for (m = 0, len2 = explicit.length; m < len2; m++) {
          command = explicit[m];
          explicitSum += command.unit.base;
        }
        wildcardArea -= explicitSum;
        if (wildcardArea < 0) {
          wildcardArea = 0;
        }
        if (fill) {
          length = lengthOf(fill, gn.variables);
          fillIterations = 0;
          if (length > 0) {
            fillIterations = Math.floor(wildcardArea / length);
          }
          fillCollection = [];
          fillWidth = 0;
          for (i = n = 1, ref8 = fillIterations; 1 <= ref8 ? n <= ref8 : n >= ref8; i = 1 <= ref8 ? ++n : --n) {
            if (fill.isVariable) {
              fillCollection = fillCollection.concat(gn.variables[fill.id]);
              fillWidth += lengthOf(fill, gn.variables);
            } else {
              newCommand = this.cmd.parse(this.cmd.toSimpleString(fill));
              fillCollection.push(newCommand);
              fillWidth += newCommand.unit.base;
            }
          }
          wildcardArea -= fillWidth;
          newCommands = [];
          ref9 = grid.commands;
          for (i = o = 0, len3 = ref9.length; o < len3; i = ++o) {
            command = ref9[i];
            if (command.isFill) {
              newCommands = newCommands.concat(fillCollection);
            } else {
              newCommands.push(command);
            }
          }
          grid.commands = [].concat(newCommands);
        }
        explicit = find(grid.commands, function(el) {
          return el.isExplicit && !el.isFill;
        });
        explicitSum = 0;
        for (p = 0, len4 = explicit.length; p < len4; p++) {
          command = explicit[p];
          explicitSum += command.unit.base;
        }
        if (((ref10 = grid.params.width) != null ? (ref11 = ref10.unit) != null ? ref11.base : void 0 : void 0) == null) {
          if (wildcards.length === 0) {
            adjustRemainder = originalWidth - explicitSum;
          }
          wildcardArea -= ((ref12 = grid.params.firstOffset) != null ? (ref13 = ref12.unit) != null ? ref13.base : void 0 : void 0) || 0;
          wildcardArea -= ((ref14 = grid.params.lastOffset) != null ? (ref15 = ref14.unit) != null ? ref15.base : void 0 : void 0) || 0;
        }
        if (adjustRemainder > 0) {
          adjustRemainder -= ((ref16 = grid.params.firstOffset) != null ? (ref17 = ref16.unit) != null ? ref17.base : void 0 : void 0) || 0;
          adjustRemainder -= ((ref18 = grid.params.lastOffset) != null ? (ref19 = ref18.unit) != null ? ref19.base : void 0 : void 0) || 0;
        }
        if ((ref20 = grid.params.firstOffset) != null ? ref20.isWildcard : void 0) {
          stretchDivisions++;
        }
        if ((ref21 = grid.params.lastOffset) != null ? ref21.isWildcard : void 0) {
          stretchDivisions++;
        }
        adjust = adjustRemainder / stretchDivisions;
        if ((ref22 = grid.params.firstOffset) != null ? ref22.isWildcard : void 0) {
          if (wholePixels) {
            adjust = Math.ceil(adjust);
          }
          grid.params.firstOffset = this.cmd.parse(adjust + "px");
        }
        if ((ref23 = grid.params.lastOffset) != null ? ref23.isWildcard : void 0) {
          if (wholePixels) {
            adjust = Math.floor(adjust);
          }
          grid.params.lastOffset = this.cmd.parse(adjust + "px");
        }
        offset += ((ref24 = grid.params.firstOffset) != null ? ref24.unit.base : void 0) || 0;
        if ((wildcardArea != null) && wildcards) {
          wildcardWidth = wildcardArea / wildcards.length;
          if (wholePixels) {
            wildcardWidth = Math.floor(wildcardWidth);
            remainderPixels = wildcardArea % wildcards.length;
          }
          for (q = 0, len5 = wildcards.length; q < len5; q++) {
            command = wildcards[q];
            command.isWildcard = false;
            command.isExplicit = true;
            command.isFill = true;
            command.multiplier = 1;
            command.isPercent = false;
            command.unit = this.unit.parse(wildcardWidth + "px");
          }
        }
        if (remainderPixels) {
          remainderOffset = 0;
          if (grid.params.remainder === 'c') {
            remainderOffset = Math.floor((wildcards.length - remainderPixels) / 2);
          }
          if (grid.params.remainder === 'l') {
            remainderOffset = wildcards.length - remainderPixels;
          }
          for (i = r = 0, len6 = wildcards.length; r < len6; i = ++r) {
            command = wildcards[i];
            if (i >= remainderOffset && i < remainderOffset + remainderPixels) {
              command.unit = this.unit.parse((wildcardWidth + 1) + "px");
            }
          }
        }
        insertMarker = offset;
        newCommands = [];
        ref25 = grid.commands;
        for (i = s = 0, len7 = ref25.length; s < len7; i = ++s) {
          command = ref25[i];
          if (!command.isGuide || (command.isGuide && !((ref26 = grid.commands[i - 1]) != null ? ref26.isGuide : void 0))) {
            newCommands.push(command);
          }
        }
        grid.commands = [].concat(newCommands);
        ref27 = grid.commands;
        for (t = 0, len8 = ref27.length; t < len8; t++) {
          command = ref27[t];
          if (command.isGuide) {
            guides.push({
              location: insertMarker,
              orientation: guideOrientation
            });
          } else {
            insertMarker += command.unit.base;
          }
        }
      }
      return guides;
    };

    GridNotation.prototype.clean = function(string) {
      var gn, grid, j, key, len, line, ref, ref1, variable;
      if (string == null) {
        string = "";
      }
      gn = this.validate(this.objectify(string)).obj;
      string = "";
      ref = gn.variables;
      for (key in ref) {
        variable = ref[key];
        string += key + " = " + (this.stringifyCommands(variable)) + "\n";
      }
      if (gn.variables.length > 0) {
        string += "\n";
      }
      ref1 = gn.grids;
      for (j = 0, len = ref1.length; j < len; j++) {
        grid = ref1[j];
        line = "";
        line += this.stringifyCommands(grid.commands);
        line += " " + (this.stringifyParams(grid.params));
        string += (trim(line)) + "\n";
      }
      return trim(string.replace(/\n\n\n+/g, "\n"));
    };

    GridNotation.prototype.stringify = function(data) {
      var column, firstMargString, gridString, gutter, lastMargString, left, optionsString, right, unit, varString;
      data || (data = {});
      data.count = parseInt(data.count);
      data.width || (data.width = '');
      data.gutter || (data.gutter = '');
      data.firstMargin || (data.firstMargin = '');
      data.lastMargin || (data.lastMargin = '');
      data.columnMidpoint || (data.columnMidpoint = false);
      data.gutterMidpoint || (data.gutterMidpoint = false);
      data.orientation || (data.orientation = 'v');
      data.position || (data.position = 'f');
      data.remainder || (data.remainder = 'l');
      data.calculation || (data.calculation = '');
      firstMargString = '';
      varString = '';
      gridString = '';
      lastMargString = '';
      optionsString = '';
      if (data.firstMargin) {
        firstMargString = '|' + data.firstMargin.replace(/,|\s+/g, ' ').split(' ').join('|') + '|';
      }
      if (data.lastMargin) {
        lastMargString = '|' + data.lastMargin.replace(/,|\s+/g, ' ').split(' ').reverse().join('|') + '|';
      }
      if (data.count || data.width) {
        column = data.width ? data.width : '~';
        if (data.columnMidpoint) {
          left = right = '~';
          if (data.width) {
            unit = this.unit.parse(data.width);
            left = "" + (data.calculation === 'p' && unit.type === 'px' ? Math.floor(unit.value / 2) : unit.value / 2) + unit.type;
            right = "" + (data.calculation === 'p' && unit.type === 'px' ? Math.ceil(unit.value / 2) : unit.value / 2) + unit.type;
          }
          column = left + "|" + right;
        }
        varString += "$" + data.orientation + " = |" + column + "|\n";
        if (data.gutter && data.count !== 1) {
          gutter = data.gutter ? data.gutter : '~';
          if (data.gutterMidpoint) {
            left = right = '~';
            if (data.gutter) {
              unit = this.unit.parse(data.gutter);
              left = "" + (data.calculation === 'p' && unit.type === 'px' ? Math.floor(unit.value / 2) : unit.value / 2) + unit.type;
              right = "" + (data.calculation === 'p' && unit.type === 'px' ? Math.ceil(unit.value / 2) : unit.value / 2) + unit.type;
            }
            gutter = left + "|" + right;
          }
          varString = "$" + data.orientation + " = |" + column + "|" + gutter + "|\n";
          varString += "$" + data.orientation + "C = |" + column + "|\n";
        }
      }
      if (data.count || data.width) {
        gridString += "|$" + data.orientation;
        if (data.count !== 1) {
          gridString += "*";
        }
        if (data.count > 1 && data.gutter) {
          gridString += data.count - 1;
        }
        if (data.count > 1 && !data.gutter) {
          gridString += data.count;
        }
        gridString += "|";
        if (data.gutter && data.count !== 1) {
          gridString += "|$" + data.orientation + (data.gutter ? 'C' : '') + "|";
        }
      }
      if ((!data.count && !data.width) && data.firstMargin) {
        gridString += "|";
      }
      if ((!data.count && !data.width) && (data.firstMargin || data.lastMargin)) {
        gridString += "~";
      }
      if ((!data.count && !data.width) && data.lastMargin) {
        gridString += "|";
      }
      if (data.firstMargin || data.lastMargin || data.count || data.width) {
        optionsString += " ( ";
        optionsString += data.orientation;
        optionsString += data.remainder;
        if (data.calculation === "p") {
          optionsString += "p";
        }
        optionsString += ", ";
        if (data.position === "l" || data.position === "c") {
          optionsString += "~";
        }
        optionsString += "|";
        if (data.position === "f" || data.position === "c") {
          optionsString += "~";
        }
        optionsString += " )";
      }
      return this.pipeCleaner(("" + varString + firstMargString + gridString + lastMargString + optionsString).replace(/\|+/g, "|"));
    };

    GridNotation.prototype.test = function(string) {
      return this.validate(this.objectify(string)).errors;
    };

    GridNotation.prototype.objectify = function(string) {
      var grid, grids, j, len, line, lines, variable, variables;
      if (string == null) {
        string = "";
      }
      lines = string.split(/\n/g);
      string = "";
      variables = {};
      grids = [];
      for (j = 0, len = lines.length; j < len; j++) {
        line = lines[j];
        if (/^\$.*?\s?=.*$/i.test(line)) {
          variable = this.parseVariable(line);
          variables[variable.id] = variable.commands;
        } else if (/^\s*#/i.test(line)) {

        } else {
          grid = this.parseGrid(line);
          if (grid.commands.length > 0) {
            grids.push(grid);
          }
        }
      }
      return {
        variables: variables,
        grids: grids
      };
    };

    GridNotation.prototype.validate = function(obj) {
      var command, commands, errors, fills, first, grid, id, j, key, l, last, len, len1, ref, ref1, ref2, varHasFill, varHasWildcard, variable, variablesWithWildcards, width;
      variablesWithWildcards = {};
      errors = [];
      if (obj.grids.length <= 0) {
        error(2, errors);
      }
      ref = obj.variables;
      for (key in ref) {
        commands = ref[key];
        for (j = 0, len = commands.length; j < len; j++) {
          command = commands[j];
          if (command.errors.length > 0) {
            error(command.errors, errors);
          }
          id = command.id;
          if (id) {
            variable = obj.variables[id];
          }
          if (id && !variable) {
            error(6, errors, command);
          }
          if (command.isFill) {
            error(5, errors, command);
          }
          if (command.isWildcard) {
            variablesWithWildcards[key] = true;
          }
        }
      }
      ref1 = obj.grids;
      for (key in ref1) {
        grid = ref1[key];
        fills = 0;
        first = grid.params.firstOffset;
        width = grid.params.width;
        last = grid.params.lastOffset;
        if (first && first.errors.length > 0) {
          error(1, errors);
        }
        if (width && width.errors.length > 0) {
          error(1, errors);
        }
        if (last && last.errors.length > 0) {
          error(1, errors);
        }
        ref2 = grid.commands;
        for (l = 0, len1 = ref2.length; l < len1; l++) {
          command = ref2[l];
          if (command.errors.length > 0) {
            error(command.errors, errors);
          }
          id = command.id;
          if (id) {
            variable = obj.variables[id];
          }
          if (id && !variable) {
            error(6, errors, command);
          }
          varHasWildcard = find(variable, function(el) {
            return el.isWildcard;
          }).length > 0;
          if (command.isFill && varHasWildcard) {
            error(3, errors, command);
          }
          if (command.isFill) {
            fills++;
          }
          varHasFill = find(variable, function(el) {
            return el.isFill;
          }).length > 0;
          if (id && variable && varHasFill) {
            fills++;
          }
          if (fills > 1) {
            error(4, errors, command);
          }
          if (id && variable && varHasFill) {
            error(5, errors, command);
          }
        }
      }
      return {
        errors: errors.sort(),
        obj: obj
      };
    };

    GridNotation.prototype.parseCommands = function(string) {
      var commands, j, len, token, tokens;
      if (string == null) {
        string = "";
      }
      string = this.pipeCleaner(string);
      commands = [];
      if (string === "") {
        return commands;
      }
      tokens = string.replace(/^\s+|\s+$/g, '').replace(/\s\s+/g, ' ').split(/\s/);
      for (j = 0, len = tokens.length; j < len; j++) {
        token = tokens[j];
        commands.push(this.cmd.parse(token));
      }
      return commands;
    };

    GridNotation.prototype.expandCommands = function(commands, variables) {
      var command, i, j, l, len, len1, loops, m, newCommands, ref, reparse, varWidths;
      if (commands == null) {
        commands = [];
      }
      if (variables == null) {
        variables = {};
      }
      if (typeof commands === "string") {
        commands = this.parseCommands(commands);
      }
      reparse = true;
      varWidths = {};
      while (reparse === true) {
        reparse = false;
        newCommands = [];
        for (j = 0, len = commands.length; j < len; j++) {
          command = commands[j];
          if (command.isFill) {
            newCommands.push(command);
          } else {
            loops = command.multiplier || 1;
            for (i = l = 0, ref = loops; l < ref; i = l += 1) {
              newCommands.push(this.cmd.parse(this.cmd.toSimpleString(command)));
            }
          }
        }
        commands = [].concat(newCommands);
        newCommands = [];
        for (i = m = 0, len1 = commands.length; m < len1; i = ++m) {
          command = commands[i];
          if (command.isVariable && variables && variables[command.id] && !command.isFill) {
            reparse = true;
            newCommands = newCommands.concat(variables[command.id]);
          } else {
            newCommands.push(command);
          }
        }
        commands = [].concat(newCommands);
      }
      return commands;
    };

    GridNotation.prototype.isCommands = function(string) {
      var commands;
      if (string == null) {
        string = "";
      }
      if (string === "") {
        return false;
      }
      if (string.indexOf("|") >= 0) {
        return true;
      }
      commands = this.parseCommands(string);
      if (commands.length > 1) {
        return true;
      }
      if (commands[0].errors.length === 0) {
        return true;
      }
      return false;
    };

    GridNotation.prototype.parseGrid = function(string) {
      var commands, params, regex;
      if (string == null) {
        string = "";
      }
      regex = /\((.*?)\)/i;
      params = regex.exec(string) || [];
      string = trim(string.replace(regex, ''));
      commands = this.parseCommands(string);
      return {
        commands: commands,
        wildcards: find(commands, function(el) {
          return el.isWildcard;
        }),
        params: this.parseParams(params[1] || '')
      };
    };

    GridNotation.prototype.parseParams = function(string) {
      var bits, k, obj, ref, ref1, ref2, ref3, v;
      if (string == null) {
        string = "";
      }
      bits = string.replace(/[\s\(\)]/g, '').split(',');
      obj = {
        orientation: "h",
        remainder: "l",
        calculation: ""
      };
      if (bits.length > 1) {
        ref = this.parseOptions(bits[0]);
        for (k in ref) {
          v = ref[k];
          obj[k] = v;
        }
        ref1 = this.parseAdjustments(bits[1] || "");
        for (k in ref1) {
          v = ref1[k];
          obj[k] = v;
        }
        return obj;
      } else if (bits.length === 1) {
        if (this.isCommands(bits[0])) {
          ref2 = this.parseAdjustments(bits[0] || "");
          for (k in ref2) {
            v = ref2[k];
            obj[k] = v;
          }
        } else {
          ref3 = this.parseOptions(bits[0]);
          for (k in ref3) {
            v = ref3[k];
            obj[k] = v;
          }
        }
      }
      return obj;
    };

    GridNotation.prototype.parseOptions = function(string) {
      var j, len, obj, option, options;
      if (string == null) {
        string = "";
      }
      options = string.split('');
      obj = {};
      for (j = 0, len = options.length; j < len; j++) {
        option = options[j];
        switch (option.toLowerCase()) {
          case "h":
          case "v":
            obj.orientation = option;
            break;
          case "f":
          case "c":
          case "l":
            obj.remainder = option;
            break;
          case "p":
            obj.calculation = option;
        }
      }
      return obj;
    };

    GridNotation.prototype.parseAdjustments = function(string) {
      var adj, bits, el, end, i, j, len, ref, ref1;
      if (string == null) {
        string = "";
      }
      adj = {
        firstOffset: null,
        width: null,
        lastOffset: null
      };
      if (string === "") {
        return adj;
      }
      bits = this.expandCommands(string.replace(/\s/, '')).splice(0, 5);
      end = bits.length - 1;
      if (bits.length > 1 && !bits[end].isGuide) {
        adj.lastOffset = bits[end];
      }
      if (!bits[0].isGuide) {
        adj.firstOffset = bits[0];
      }
      for (i = j = 0, len = bits.length; j < len; i = ++j) {
        el = bits[i];
        if (((ref = bits[i - 1]) != null ? ref.isGuide : void 0) && ((ref1 = bits[i + 1]) != null ? ref1.isGuide : void 0)) {
          if (!el.isGuide) {
            adj.width = el;
          }
        }
      }
      return adj;
    };

    GridNotation.prototype.parseVariable = function(string) {
      var bits;
      bits = /^\$([^=\s]+)?\s?=\s?(.*)$/i.exec(string);
      if (bits[2] == null) {
        return null;
      }
      return {
        id: bits[1] ? "$" + bits[1] : "$",
        commands: this.parseCommands(bits[2])
      };
    };

    GridNotation.prototype.pipeCleaner = function(string) {
      if (string == null) {
        string = "";
      }
      return string.replace(/[^\S\n]*\|[^\S\n]*/g, '|').replace(/\|+/g, ' | ').replace(/^\s+|\s+$/gm, '');
    };

    GridNotation.prototype.stringifyCommands = function(commands) {
      var command, j, len, string;
      string = "";
      for (j = 0, len = commands.length; j < len; j++) {
        command = commands[j];
        string += " " + this.cmd.stringify(command);
      }
      return this.pipeCleaner(string);
    };

    GridNotation.prototype.stringifyParams = function(params) {
      var string;
      string = "";
      string += "" + (params.orientation || '');
      string += "" + (params.remainder || '');
      string += "" + (params.calculation || '');
      if (params.firstOffset || params.width || params.lastOffset) {
        if (string.length > 0) {
          string += ", ";
        }
      }
      if (params.firstOffset) {
        string += this.cmd.stringify(params.firstOffset);
      }
      if (params.firstOffset || params.width) {
        string += "|";
      }
      if (params.width) {
        string += "" + (this.cmd.stringify(params.width));
      }
      if (params.lastOffset || params.width) {
        string += "|";
      }
      if (params.lastOffset) {
        string += this.cmd.stringify(params.lastOffset);
      }
      if (string) {
        return "( " + (this.pipeCleaner(string)) + " )";
      } else {
        return '';
      }
    };

    return GridNotation;

  })();

  Command = (function() {
    Command.prototype.variableRegexp = /^\$([^\*]+)?(\*(\d+)?)?$/i;

    Command.prototype.explicitRegexp = /^(([-0-9\.]+)?[a-z%]+)(\*(\d+)?)?$/i;

    Command.prototype.wildcardRegexp = /^~(\*(\d*))?$/i;

    function Command(args) {
      if (args == null) {
        args = {};
      }
      this.isWildcard = bind(this.isWildcard, this);
      this.isExplicit = bind(this.isExplicit, this);
      this.isVariable = bind(this.isVariable, this);
      this.unit = new Unit();
    }

    Command.prototype.isGuide = function(command) {
      if (command == null) {
        command = "";
      }
      if (typeof command === "string") {
        return command.replace(/\s/g, '') === "|";
      } else {
        return command.isGuide || false;
      }
    };

    Command.prototype.isVariable = function(command) {
      if (command == null) {
        command = "";
      }
      if (typeof command === "string") {
        return this.variableRegexp.test(command.replace(/\s/g, ''));
      } else {
        return command.isVariable || false;
      }
    };

    Command.prototype.isExplicit = function(command) {
      if (command == null) {
        command = "";
      }
      if (typeof command === "string") {
        if (!this.explicitRegexp.test(command.replace(/\s/g, ''))) {
          return false;
        }
        if (this.unit.parse(command) === null) {
          return false;
        }
        return true;
      } else {
        return command.isExplicit || false;
      }
    };

    Command.prototype.isWildcard = function(command) {
      if (command == null) {
        command = "";
      }
      if (typeof command === "string") {
        return this.wildcardRegexp.test(command.replace(/\s/g, ''));
      } else {
        return command.isWildcard || false;
      }
    };

    Command.prototype.isPercent = function(command) {
      var unit;
      if (command == null) {
        command = "";
      }
      if (typeof command === "string") {
        unit = this.unit.parse(command.replace(/\s/g, ''));
        return (unit != null) && unit.type === '%';
      } else {
        return command.isPercent || false;
      }
    };

    Command.prototype.isFill = function(string) {
      var bits;
      if (string == null) {
        string = "";
      }
      if (this.isVariable(string)) {
        bits = this.variableRegexp.exec(string);
        return bits[2] && !bits[3] || false;
      } else if (this.isExplicit(string)) {
        bits = this.explicitRegexp.exec(string);
        return bits[3] && !bits[4] || false;
      } else if (this.isWildcard(string)) {
        bits = this.wildcardRegexp.exec(string);
        return bits[1] && !bits[2] || false;
      } else {
        return false;
      }
    };

    Command.prototype.count = function(string) {
      if (string == null) {
        string = "";
      }
      string = string.replace(/\s/g, '');
      if (this.isVariable(string)) {
        return parseInt(this.variableRegexp.exec(string)[3]) || 1;
      } else if (this.isExplicit(string)) {
        return parseInt(this.explicitRegexp.exec(string)[4]) || 1;
      } else if (this.isWildcard(string)) {
        return parseInt(this.wildcardRegexp.exec(string)[2]) || 1;
      } else {
        return null;
      }
    };

    Command.prototype.parse = function(string) {
      var bits;
      if (string == null) {
        string = "";
      }
      string = string.replace(/\s/g, '');
      if (this.isGuide(string)) {
        return {
          errors: [],
          isGuide: true
        };
      } else if (this.isVariable(string)) {
        bits = this.variableRegexp.exec(string);
        return {
          errors: [],
          isVariable: true,
          isFill: this.isFill(string),
          id: bits[1] ? "$" + bits[1] : "$",
          multiplier: this.count(string)
        };
      } else if (this.isExplicit(string)) {
        return {
          errors: [],
          isExplicit: true,
          isPercent: this.isPercent(string),
          isFill: this.isFill(string),
          unit: this.unit.parse(string),
          multiplier: this.count(string)
        };
      } else if (this.isWildcard(string)) {
        return {
          errors: this.isFill(string) ? [3] : [],
          isWildcard: true,
          isFill: this.isFill(string),
          multiplier: this.count(string)
        };
      } else {
        return {
          errors: [1],
          string: string
        };
      }
    };

    Command.prototype.stringify = function(command) {
      var string;
      if (command == null) {
        command = "";
      }
      if (typeof command === "string") {
        return command;
      }
      string = "";
      if (command.isGuide) {
        string += "|";
      } else if (command.isVariable) {
        string += command.id;
      } else if (command.isExplicit) {
        string += this.unit.stringify(command.unit);
      } else if (command.isWildcard) {
        string += "~";
      } else {
        if (command.string === "") {
          return "";
        }
        string += command.string;
      }
      if (command.isVariable || command.isExplicit || command.isWildcard) {
        if (command.isFill || command.multiplier > 1) {
          string += '*';
        }
        if (command.multiplier > 1) {
          string += command.multiplier;
        }
      }
      if (command.errors.length === 0) {
        return string;
      } else {
        return "{" + string + " [" + (command.errors.join(',')) + "]}";
      }
    };

    Command.prototype.toSimpleString = function(command) {
      if (command == null) {
        command = "";
      }
      if (typeof command === "string") {
        return command.replace(/\*.*/gi, "");
      }
      return this.stringify(command).replace(/[\{\}]|\*.*|\[\d*\]/gi, "");
    };

    return Command;

  })();

  Unit = (function() {
    Unit.prototype.resolution = 72;

    function Unit(args) {
      if (args == null) {
        args = {};
      }
      this.stringify = bind(this.stringify, this);
      this.parse = bind(this.parse, this);
    }

    Unit.prototype.parse = function(string) {
      var bits, value, zeroAdjustedValue;
      if (string == null) {
        string = "";
      }
      string = string.replace(/\s/g, '');
      bits = string.match(/([-0-9\.]+)([a-z%]+)?/i);
      if (!string || string === "" || (bits == null)) {
        return null;
      }
      if (bits[2] && !this.preferredName(bits[2])) {
        return null;
      }
      if (bits[1] && !bits[2]) {
        zeroAdjustedValue = bits[1].replace(/^\./, '0.');
        value = parseFloat(bits[1]);
        if (value.toString() === zeroAdjustedValue) {
          return value;
        } else {
          return null;
        }
      }
      return {
        string: string,
        value: parseFloat(bits[1]),
        type: this.preferredName(bits[2]),
        base: this.asBaseUnit({
          value: parseFloat(bits[1]),
          type: this.preferredName(bits[2])
        })
      };
    };

    Unit.prototype.preferredName = function(string) {
      switch (string) {
        case 'centimeter':
        case 'centimeters':
        case 'centimetre':
        case 'centimetres':
        case 'cm':
          return 'cm';
        case 'inch':
        case 'inches':
        case 'in':
          return 'in';
        case 'millimeter':
        case 'millimeters':
        case 'millimetre':
        case 'millimetres':
        case 'mm':
          return 'mm';
        case 'pixel':
        case 'pixels':
        case 'px':
          return 'px';
        case 'point':
        case 'points':
        case 'pts':
        case 'pt':
          return 'points';
        case 'pica':
        case 'picas':
          return 'picas';
        case 'percent':
        case 'pct':
        case '%':
          return '%';
        default:
          return null;
      }
    };

    Unit.prototype.asBaseUnit = function(unit) {
      if (!((unit != null) && (unit.value != null) && (unit.type != null))) {
        return null;
      }
      switch (unit.type) {
        case 'cm':
          unit.value = unit.value / 2.54;
          break;
        case 'in':
          unit.value = unit.value / 1;
          break;
        case 'mm':
          unit.value = unit.value / 25.4;
          break;
        case 'px':
          unit.value = unit.value / this.resolution;
          break;
        case 'points':
          unit.value = unit.value / 72;
          break;
        case 'picas':
          unit.value = unit.value / 6;
          break;
        default:
          return null;
      }
      return unit.value * this.resolution;
    };

    Unit.prototype.stringify = function(unit) {
      if (unit == null) {
        unit = "";
      }
      if (unit === "") {
        return null;
      }
      if (typeof unit === "string") {
        return this.stringify(this.parse(unit));
      }
      return "" + unit.value + unit.type;
    };

    return Unit;

  })();

  trim = function(string) {
    return string.replace(/^\s+|\s+$/g, '');
  };

  find = function(arr, iterator) {
    var el, i, j, len, matches;
    if (!(arr && iterator)) {
      return [];
    }
    matches = [];
    for (i = j = 0, len = arr.length; j < len; i = ++j) {
      el = arr[i];
      if (iterator(el) === true) {
        matches.push(el);
      }
    }
    return matches;
  };

  lengthOf = function(command, variables) {
    var j, len, ref, ref1, sum;
    if (!command.isVariable) {
      return command.unit.value * command.multiplier;
    }
    if (!variables[command.id]) {
      return 0;
    }
    sum = 0;
    ref = variables[command.id];
    for (j = 0, len = ref.length; j < len; j++) {
      command = ref[j];
      sum += ((ref1 = command.unit) != null ? ref1.base : void 0) || 0;
    }
    return sum;
  };

  error = function(codes, master, command) {
    var code, exists, j, len;
    if (typeof codes === "number") {
      codes = [codes];
    }
    for (j = 0, len = codes.length; j < len; j++) {
      code = codes[j];
      exists = find(master, (function(e, i) {
        if (e === code) {
          return true;
        }
      })).length > 0;
      if (!exists) {
        master.push(code);
      }
      if (!command) {
        return;
      }
      command.errors || (command.errors = []);
      command.isValid = false;
      exists = find(command.errors, (function(e, i) {
        if (e === code) {
          return true;
        }
      })).length > 0;
      if (!exists) {
        command.errors.push(code);
      }
    }
  };

  if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    module.exports = {
      notation: new GridNotation(),
      unit: new Unit(),
      command: new Command()
    };
  } else {
    window.GridNotation = new GridNotation();
    window.Unit = new Unit();
    window.Command = new Command();
  }

}).call(this);

define("gridnotation", (function (global) {
    return function () {
        var ret, fn;
        return ret || global.GridNotation;
    };
}(this)));

require([
  'jquery',
  'backbone',
  'cs!views/root',
  'cs!routers/GuideGuide',
  'cs!lib/bridge',
  'lib/backbone.bridgeStorage',
  'gridnotation'
], function ($, Backbone, RootView, GuideGuideRouter) {
  $(function() {
    // Hack to prevent issues with Node.js in early Photoshop CC 2014
    window.module = undefined;

    Backbone.history.start({
      pushState: false,
      root: '/',
      silent: true
    });

    // RootView may use link or url helpers which
    // depend on Backbone history being setup
    // so need to wait to loadUrl() (which will)
    // actually execute the route
    RootView.getInstance(document.body);

    // Initialize your routers here
    new GuideGuideRouter();

    // This will trigger your routers to start
    Backbone.history.loadUrl();
  });
});

define("main", function(){});


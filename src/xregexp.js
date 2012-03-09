/*!
 * XRegExp v2.0.0-beta
 * Copyright 2007-2012 Steven Levithan <http://xregexp.com/>
 * Available under the MIT License
 * Augmented, extensible, cross-browser regular expressions
 */

// Avoid running twice; that could break references to native globals
;if (typeof XRegExp === "undefined") {
(function (root, undefined) {
    "use strict";

    //---------------------------------
    //  Constructor
    //---------------------------------

    // Accepts a pattern and flags; returns a new, extended `RegExp` object. Differs from a native
    // regular expression in that additional syntax and flags are supported and cross-browser
    // syntax inconsistencies are ameliorated. `XRegExp(/regex/)` clones an existing regex
    function XRegExp (pattern, flags) {
        if (XRegExp.isRegExp(pattern)) {
            if (flags !== undefined)
                throw new TypeError("can't supply flags when constructing one RegExp from another");
            return copy(pattern);
        }
        // Tokens become part of the regex construction process, so protect against infinite
        // recursion when an XRegExp is constructed within a token handler or trigger
        if (isInsideConstructor)
            throw new Error("can't call the XRegExp constructor within token definition functions");
        var output = [],
            scope = defaultScope,
            tokenContext = {
                hasNamedCapture: false,
                captureNames: [],
                hasFlag: function (flag) {return flags.indexOf(flag) > -1;},
                setFlag: function (flag) {flags += flag;}
            },
            pos = 0,
            tokenResult, match, chr;
        pattern = pattern === undefined ? "" : pattern + "";
        flags = flags === undefined ? "" : flags + "";
        while (pos < pattern.length) {
            // Check for custom tokens at the current position
            tokenResult = runTokens(pattern, pos, scope, tokenContext);
            if (tokenResult) {
                output.push(tokenResult.output);
                pos += (tokenResult.match[0].length || 1);
            } else {
                // Check for native multichar tokens (except char classes) at the current position
                if ((match = nativ.exec.call(nativeTokens[scope], pattern.slice(pos)))) {
                    output.push(match[0]);
                    pos += match[0].length;
                } else {
                    chr = pattern.charAt(pos);
                    if (chr === "[") scope = classScope;
                    else if (chr === "]") scope = defaultScope;
                    // Advance position one character
                    output.push(chr);
                    pos++;
                }
            }
        }
        return augment(new RegExp(output.join(""), nativ.replace.call(flags, flagClip, "")), tokenContext);
    }


    //---------------------------------
    //  Private variables
    //---------------------------------

    var features = { // Optional features, can be installed and uninstalled
            natives: false,
            methods: false,
            extensibility: false
        },

        // Store native globals to use and restore ("native" is an ES3 reserved keyword)
        nativ = {
            exec: RegExp.prototype.exec,
            test: RegExp.prototype.test,
            match: String.prototype.match,
            replace: String.prototype.replace,
            split: String.prototype.split,
            // Hold these so they can be given back if added before XRegExp ran
            apply: RegExp.prototype.apply,
            call: RegExp.prototype.call
        },

        // Storage for fixed/extended native methods
        fixed = {},

        // Storage for addon tokens
        tokens = [],

        // Token scope bitflags
        classScope = 0x1,
        defaultScope = 0x2,

        // `XRegExp.addToken` installed and uninstalled states
        addToken = {
            on: function (regex, handler, scope, trigger) {
                tokens.push({
                    pattern: copy(regex, "g" + (hasNativeY ? "y" : "")),
                    handler: handler,
                    scope: scope || defaultScope,
                    trigger: trigger || null
                });
            },
            off: function () {
                throw new Error("extensibility must be installed before running addToken");
            }
        };


    //---------------------------------
    //  Public properties/methods
    //---------------------------------

    extend(XRegExp, {
        version: "2.0.0-beta",

        // Token scope bitflags
        INSIDE_CLASS: classScope,
        OUTSIDE_CLASS: defaultScope,

        // Lets you extend or change XRegExp syntax and create custom flags. This is used internally by
        // the XRegExp library and can be used to create XRegExp addons. This function is intended for
        // users with advanced knowledge of JavaScript's regular expression syntax and behavior. To use
        // it, you must first run `XRegExp.install("extensibility"). It can be disabled by
        // `XRegExp.uninstall("extensibility")`
        addToken: addToken.off,

        // Accepts a pattern and flags; returns an extended `RegExp` object. If the pattern and flag
        // combination has previously been cached, the cached copy is returned; otherwise the newly
        // created regex is cached
        cache: function (pattern, flags) {
            var key = pattern + "/" + (flags || "");
            return XRegExp.cache[key] || (XRegExp.cache[key] = XRegExp(pattern, flags));
        },

        // Accepts a string; returns the string with regex metacharacters escaped. The returned string
        // can safely be used at any point within a regex to match the provided literal string. Escaped
        // characters are [ ] { } ( ) * + ? - . , \ ^ $ | # and whitespace
        escape: function (str) {
            return nativ.replace.call(str, /[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
        },

        // Accepts a string to search, regex to search with, position to start the search within the
        // string (default: 0), and an optional Boolean indicating whether matches must start at-or-
        // after the position or at the specified position only. This function ignores the `lastIndex`
        // of the provided regex in its own handling, but updates the property for compatibility
        exec: function (str, regex, pos, sticky) {
            var r2 = copy(regex, "g" + ((sticky && hasNativeY) ? "y" : "")),
                match;
            r2.lastIndex = pos = pos || 0;
            match = fixed.exec.call(r2, str); // Fixed `exec` required for `lastIndex` fix, etc.
            if (sticky && match && match.index !== pos)
                match = null;
            if (regex.global)
                regex.lastIndex = match ? r2.lastIndex : 0;
            return match;
        },

        // Executes `callback` once per match within `str`; returns `context`. Provides a simpler and
        // cleaner way to iterate over regex matches compared to the traditional approaches of
        // subverting `String.prototype.replace` or repeatedly calling `exec` within a `while` loop
        forEach: function (str, regex, callback, context) {
            var r2 = XRegExp.globalize(regex),
                i = -1, match;
            while ((match = fixed.exec.call(r2, str))) { // Fixed `exec` required for `lastIndex` fix, etc.
                if (regex.global)
                    regex.lastIndex = r2.lastIndex; // Doing this to follow expectations if `lastIndex` is checked within `callback`
                callback.call(context, match, ++i, str, regex);
                if (r2.lastIndex === match.index)
                    r2.lastIndex++;
            }
            if (regex.global)
                regex.lastIndex = 0;
            return context;
        },

        // Accepts a `RegExp` instance; returns a copy with the `/g` flag set. The copy has a fresh
        // `lastIndex` (set to zero). If you want to copy a regex without forcing the `global`
        // property, use `XRegExp(regex)`. Do not use `RegExp(regex)` because it will not preserve
        // special properties required for named capture
        globalize: function (regex) {
            return copy(regex, "g");
        },

        // Accepts an object or space-delimited string specifying optional features to install
        install: function (options) {
            options = prepareOptions(options);
            if (!features.natives && options.natives) setNatives(true);
            if (!features.methods && options.methods) setMethods(true);
            if (!features.extensibility && options.extensibility) setExtensibility(true);
        },

        // Accepts any value; returns a Boolean indicating whether the argument is a `RegExp` object.
        // Note that this is also `true` for regex literals and regexes created by the `XRegExp`
        // constructor. This works correctly for variables created in another frame, when `instanceof`
        // and `constructor` checks would fail to work as intended
        isRegExp: function (value) {
            return Object.prototype.toString.call(value) === "[object RegExp]";
        },

        // Checks whether an optional feature is installed
        isInstalled: function (feature) {
            return !!(features[feature]);
        },

        // Accepts a string and an array of regexes; returns the result of using each successive regex
        // to search within the matches of the previous regex. The array of regexes can also contain
        // objects with `regex` and `backref` properties, in which case the named or numbered back-
        // references specified are passed forward to the next regex or returned. E.g.:
        // domains = XRegExp.matchChain(str, [
        //     {regex: /<a href="([^"]+)">/i, backref: 1},
        //     {regex: XRegExp("(?i)^https?://(?<domain>[^/?#]+)"), backref: "domain"}
        // ]);
        matchChain: function (str, chain) {
            return function recurseChain (values, level) {
                var item = chain[level].regex ? chain[level] : {regex: chain[level]},
                    regex = XRegExp.globalize(item.regex),
                    matches = [], i;
                for (i = 0; i < values.length; i++) {
                    XRegExp.forEach(values[i], regex, function (match) {
                        matches.push(item.backref ? (match[item.backref] || "") : match[0]);
                    });
                }
                return ((level === chain.length - 1) || !matches.length) ?
                    matches : recurseChain(matches, level + 1);
            }([str], 0);
        },

        // Returns a new string with one or all matches of a pattern replaced by a replacement. The
        // pattern can be a string or a regex, and the replacement can be a string or a function to be
        // called for each match. An optional Boolean argument specifies whether to replace the first
        // match only or all matches (overrides flag `/g`). Replacement strings can use `${n}` for
        // named and numbered backreferences. Replacement functions can use named backreferences via
        // `arguments[0].name`
        replace: function (str, search, replacement, replaceAll) {
            var isRegex = XRegExp.isRegExp(search),
                search2 = search,
                result;
            if (isRegex) {
                if (replaceAll === undefined)
                    replaceAll = search.global; // Follow flag `/g` when `replaceAll` isn't explicit
                // Note that since a copy is used, `search`'s `lastIndex` isn't updated *during* replacement iterations
                search2 = copy(search, replaceAll ? "g" : "", replaceAll ? "" : "g");
            } else if (replaceAll) {
                search2 = new RegExp(XRegExp.escape(search + ""), "g");
            }
            result = fixed.replace.call(str + "", search2, replacement); // Fixed `replace` required for named backreferences, etc.
            if (isRegex && search.global)
                search.lastIndex = 0; // Fixes IE, Safari bug (last tested IE 9, Safari 5.1)
            return result;
        },

        // Fixes browser bugs in the native `String.prototype.split`
        split: function (str, separator, limit) {
            return fixed.split.call(str, separator, limit);
        },

        // Accepts an object or space-delimited string specifying optional features to uninstall
        uninstall: function (options) {
            options = prepareOptions(options);
            if (features.natives && options.natives) setNatives(false);
            if (features.methods && options.methods) setMethods(false);
            if (features.extensibility && options.extensibility) setExtensibility(false);
        }
    });


    //---------------------------------
    //  XRegExp prototype methods
    //---------------------------------

    extend(XRegExp.prototype, {
        // Accepts a context object and arguments array; returns the result of calling `exec` with the
        // first value in the arguments array. the context is ignored but is accepted for congruity
        // with `Function.prototype.apply`
        apply: function (context, args) {
            return this.test(args[0]); // Intentionally doesn't specify fixed/native `test`
        },

        // Accepts a context object and string; returns the result of calling `exec` with the provided
        // string. the context is ignored but is accepted for congruity with `Function.prototype.call`
        call: function (context, str) {
            return this.test(str); // Intentionally doesn't specify fixed/native `test`
        }
    });


    //---------------------------------
    //  Fixed/extended native methods
    //---------------------------------

    extend(fixed, {
        // Adds named capture support (with backreferences returned as `result.name`), and fixes
        // browser bugs in the native `RegExp.prototype.exec`
        exec: function (str) {
            var match, name, r2, origLastIndex;
            if (!this.global)
                origLastIndex = this.lastIndex;
            match = nativ.exec.apply(this, arguments);
            if (match) {
                // Fix browsers whose `exec` methods don't consistently return `undefined` for
                // nonparticipating capturing groups
                if (!compliantExecNpcg && match.length > 1 && indexOf(match, "") > -1) {
                    r2 = new RegExp(this.source, nativ.replace.call(getNativeFlags(this), "g", ""));
                    // Using `str.slice(match.index)` rather than `match[0]` in case lookahead allowed
                    // matching due to characters outside the match
                    nativ.replace.call((str + "").slice(match.index), r2, function () {
                        for (var i = 1; i < arguments.length - 2; i++) {
                            if (arguments[i] === undefined)
                                match[i] = undefined;
                        }
                    });
                }
                // Attach named capture properties
                if (this._xregexp && this._xregexp.captureNames) {
                    for (var i = 1; i < match.length; i++) {
                        name = this._xregexp.captureNames[i - 1];
                        if (name)
                           match[name] = match[i];
                    }
                }
                // Fix browsers that increment `lastIndex` after zero-length matches
                if (!compliantLastIndexIncrement && this.global && !match[0].length && (this.lastIndex > match.index))
                    this.lastIndex--;
            }
            if (!this.global)
                this.lastIndex = origLastIndex; // Fixes IE, Opera bug (last tested IE 9, Opera 11.6)
            return match;
        },

        // Fixes browser bugs in the native `RegExp.prototype.test`
        test: function (str) {
            // Do this the easy way :-)
            return !!fixed.exec.call(this, str);
        },

        // Adds named capture support and fixes browser bugs in the native `String.prototype.match`
        match: function (regex) {
            if (!XRegExp.isRegExp(regex))
                regex = new RegExp(regex); // Use native `RegExp`
            if (regex.global) {
                var result = nativ.match.apply(this, arguments);
                regex.lastIndex = 0; // Fixes IE bug
                return result;
            }
            return fixed.exec.call(regex, this);
        },

        // Adds support for `${n}` tokens for named and numbered backreferences in replacement text,
        // and provides named backreferences to replacement functions as `arguments[0].name`. Also
        // fixes browser bugs in replacement text syntax when performing a replacement using a nonregex
        // search value, and the value of a replacement regex's `lastIndex` property during replacement
        // iterations and upon completion. Note that this doesn't support SpiderMonkey's proprietary
        // third (`flags`) argument
        replace: function (search, replacement) {
            var isRegex = XRegExp.isRegExp(search),
                captureNames, result, str, origLastIndex;
            if (isRegex) {
                if (search._xregexp) captureNames = search._xregexp.captureNames;
                if (!search.global) origLastIndex = search.lastIndex;
            } else {
                search += "";
            }
            if (Object.prototype.toString.call(replacement) === "[object Function]") {
                result = nativ.replace.call(this + "", search, function () {
                    if (captureNames) {
                        // Change the `arguments[0]` string primitive to a String object which can store properties
                        arguments[0] = new String(arguments[0]);
                        // Store named backreferences on `arguments[0]`
                        for (var i = 0; i < captureNames.length; i++) {
                            if (captureNames[i])
                                arguments[0][captureNames[i]] = arguments[i + 1];
                        }
                    }
                    // Update `lastIndex` before calling `replacement`.
                    // Fixes IE, Chrome, Firefox, Safari bug (last tested IE 9, Chrome 17, Firefox 10, Safari 5.1)
                    if (isRegex && search.global)
                        search.lastIndex = arguments[arguments.length - 2] + arguments[0].length;
                    return replacement.apply(null, arguments);
                });
            } else {
                str = this + ""; // Ensure `args[args.length - 1]` will be a string when given nonstring `this`
                result = nativ.replace.call(str, search, function () {
                    var args = arguments; // Keep this function's `arguments` available through closure
                    return nativ.replace.call(replacement + "", replacementToken, function ($0, $1, $2) {
                        // Numbered backreference (without delimiters) or special variable
                        if ($1) {
                            if ($1 === "$") return "$";
                            if ($1 === "&") return args[0];
                            if ($1 === "`") return args[args.length - 1].slice(0, args[args.length - 2]);
                            if ($1 === "'") return args[args.length - 1].slice(args[args.length - 2] + args[0].length);
                            // Else, numbered backreference
                            /* Assert: `$10` in replacement is one of:
                            - Backreference 10, if 10 or more capturing groups exist
                            - Backreference 1 followed by `0`, if 1-9 capturing groups exist
                            - Otherwise, it's the literal string `$10`
                            Also note:
                            - Backreferences cannot be more than two digits (enforced by `replacementToken`)
                            - `$01` is equivalent to `$1` if a capturing group exists, otherwise it's the string `$01`
                            - There is no `$0` token (`$&` is the entire match) */
                            var literalNumbers = "";
                            $1 = +$1; // Type-convert; drop leading zero
                            if (!$1) // `$1` was `0` or `00`
                                return $0;
                            while ($1 > args.length - 3) {
                                literalNumbers = String.prototype.slice.call($1, -1) + literalNumbers;
                                $1 = Math.floor($1 / 10); // Drop the last digit
                            }
                            return ($1 ? args[$1] || "" : "$") + literalNumbers;
                        // Named backreference or delimited numbered backreference
                        } else {
                            /* Assert: `${n}` in replacement is one of:
                            - Backreference to numbered capture `n`. Differences from `$n`: n can be more than two digits; backreference 0 is allowed, and is the entire match.
                            - Backreference to named capture `n`, if it exists and is not a number overridden by numbered capture.
                            - Otherwise, it's the literal string `${n}` */
                            var n = +$2; // Type-convert; drop leading zeros
                            if (n <= args.length - 3)
                                return args[n];
                            n = captureNames ? indexOf(captureNames, $2) : -1;
                            return n > -1 ? args[n + 1] : $0;
                        }
                    });
                });
            }
            if (isRegex) {
                if (search.global) search.lastIndex = 0; // Fixes IE, Safari bug (last tested IE 9, Safari 5.1)
                else search.lastIndex = origLastIndex; // Fixes IE, Opera bug (last tested IE 9, Opera 11.6)
            }
            return result;
        },

        // Fixes numerous browser bugs in the native `String.prototype.split`
        split: function (s /*separator*/, limit) {
            // If separator `s` is not a regex, use the native `split`
            if (!XRegExp.isRegExp(s))
                return nativ.split.apply(this, arguments);
            var str = this + "",
                output = [],
                lastLastIndex = 0,
                match, lastLength;
            /* `limit` value conversions:
            - undefined: 4294967295 // Math.pow(2, 32) - 1
            - 0, Infinity, NaN: 0
            - Positive number: limit = Math.floor(limit); if (limit > 4294967295) limit -= 4294967296;
            - Negative number: 4294967296 - Math.floor(Math.abs(limit))
            - Other: Type-convert, then use the above rules */
            limit = limit === undefined ?
                -1 >>> 0 : // Math.pow(2, 32) - 1
                limit >>> 0; // ToUint32(limit)
            // This is required if not `s.global`, and it avoids needing to set `s.lastIndex` to zero
            // and restore it to its original value when we're done using the regex
            s = XRegExp.globalize(s);
            while ((match = fixed.exec.call(s, str))) { // Fixed `exec` required for `lastIndex` fix, etc.
                if (s.lastIndex > lastLastIndex) {
                    output.push(str.slice(lastLastIndex, match.index));
                    if (match.length > 1 && match.index < str.length)
                        Array.prototype.push.apply(output, match.slice(1));
                    lastLength = match[0].length;
                    lastLastIndex = s.lastIndex;
                    if (output.length >= limit)
                        break;
                }
                if (s.lastIndex === match.index)
                    s.lastIndex++;
            }
            if (lastLastIndex === str.length)
                (!nativ.test.call(s, "") || lastLength) && output.push("");
            else
                output.push(str.slice(lastLastIndex));
            return output.length > limit ? output.slice(0, limit) : output;
        }
    });


    //---------------------------------
    //  Built-in tokens
    //---------------------------------

    // Augment XRegExp's syntax and flags. Default scope is `XRegExp.OUTSIDE_CLASS`

    XRegExp.install("extensibility"); // Temporarily install

    // Comment pattern: (?# )
    XRegExp.addToken(
        /\(\?#[^)]*\)/,
        function (match) {
            // Keep tokens separated unless the following token is a quantifier
            return nativ.test.call(quantifier, match.input.slice(match.index + match[0].length)) ? "" : "(?:)";
        }
    );

    // Capturing group (match the opening parenthesis only).
    // Required for support of named capturing groups.
    // Also adds explicit capture mode
    XRegExp.addToken(
        /\((?!\?)/,
        function () {
            if (this.hasFlag("n")) {
                return "(?:";
            } else {
                this.captureNames.push(null);
                return "(";
            }
        }
    );

    // Named capturing group (match the opening delimiter only): (?<name>
    XRegExp.addToken(
        /\(\?<([$\w]+)>/,
        function (match) {
            if (!isNaN(match[1])) // Avoid incorrect lookups since named backreferences are added to match arrays
                throw new SyntaxError("cannot use an integer as capture name");
            this.captureNames.push(match[1]);
            this.hasNamedCapture = true;
            return "(";
        }
    );

    // Named backreference: \k<name>
    XRegExp.addToken(
        /\\k<([\w$]+)>/,
        function (match) {
            var index = indexOf(this.captureNames, match[1]);
            // Keep backreferences separate from subsequent literal numbers. Preserve back-
            // references to named groups that are undefined at this point as literal strings
            return index > -1 ?
                "\\" + (index + 1) + (isNaN(match.input.charAt(match.index + match[0].length)) ? "" : "(?:)") :
                match[0];
        }
    );

    // Empty character class: [] or [^]
    XRegExp.addToken(
        /\[\^?]/,
        function (match) {
            // For cross-browser compatibility with ES3, convert [] to \b\B and [^] to [\s\S].
            // (?!) should work like \b\B, but is unreliable in Firefox
            return match[0] === "[]" ? "\\b\\B" : "[\\s\\S]";
        }
    );

    // Mode modifier at the start of the pattern only, with any combination of flags imnsx: (?imnsx)
    // Does not support ..(?i), (?-i), (?i-m), (?i: ), (?i)(?m), etc.
    XRegExp.addToken(
        /^\(\?([imnsx]+)\)/,
        function (match) {
            this.setFlag(match[1]);
            return "";
        }
    );

    // Whitespace and comments, in free-spacing (aka extended) mode only
    XRegExp.addToken(
        /(?:\s+|#.*)+/,
        function (match) {
            // Keep tokens separated unless the following token is a quantifier
            return nativ.test.call(quantifier, match.input.slice(match.index + match[0].length)) ? "" : "(?:)";
        },
        XRegExp.OUTSIDE_CLASS,
        function () {return this.hasFlag("x");}
    );

    // Dot, in dotall (aka singleline) mode only
    XRegExp.addToken(
        /\./,
        function () {return "[\\s\\S]";},
        XRegExp.OUTSIDE_CLASS,
        function () {return this.hasFlag("s");}
    );

    XRegExp.uninstall("extensibility"); // Revert to default state


    //---------------------------------
    //  Private variables, part 2
    //---------------------------------

    var isInsideConstructor = false, // Used during XRegExp construction

        // Any backreference in replacement strings
        replacementToken = /\$(?:(\d\d?|[$&`'])|{([$\w]+)})/g,

        // Nonnative and duplicate flags
        flagClip = /[^gimy]+|([\s\S])(?=[\s\S]*\1)/g,

        // Any regex quantifier
        quantifier = /^(?:[?*+]|{\d+(?:,\d*)?})\??/,

        // Check for correct `exec` handling of nonparticipating capturing groups
        compliantExecNpcg = nativ.exec.call(/()??/, "")[1] === undefined,

        // Check for correct handling of `lastIndex` after zero-length matches
        compliantLastIndexIncrement = function () {
            var x = /^/g;
            nativ.test.call(x, "");
            return !x.lastIndex;
        }(),

        // Check for flag y support (Firefox 3+)
        hasNativeY = RegExp.prototype.sticky !== undefined,

        // Storage for regexes that match native regex syntax
        nativeTokens = {};

    // Any native regex multicharacter token in character class scope (includes octals)
    nativeTokens[classScope] = /^(?:\\(?:[0-3][0-7]{0,2}|[4-7][0-7]?|x[\dA-Fa-f]{2}|u[\dA-Fa-f]{4}|c[A-Za-z]|[\s\S]))/;
    // Any native regex multicharacter token in default scope (includes octals, excludes character classes)
    nativeTokens[defaultScope] = /^(?:\\(?:0(?:[0-3][0-7]{0,2}|[4-7][0-7]?)?|[1-9]\d*|x[\dA-Fa-f]{2}|u[\dA-Fa-f]{4}|c[A-Za-z]|[\s\S])|\(\?[:=!]|[?*+]\?|{\d+(?:,\d*)?}\??)/;


    //---------------------------------
    //  Private helper functions
    //---------------------------------

    function augment (regex, details) {
        return extend(regex, {
            _xregexp: {captureNames: details.hasNamedCapture ? details.captureNames : null},
            // Can't automatically inherit these methods since the XRegExp constructor returns a
            // nonprimitive value
            apply: XRegExp.prototype.apply,
            call: XRegExp.prototype.call
        });
    }

    /**
     * Returns a new copy of a `RegExp` object (with its `lastIndex` zeroed), preserving properties
     * required for named capture. Allows adding and removing flags while copying the regex.
     * @private
     * @param {RegExp} regex The regex to copy.
     * @param {String} addFlags List of flags to be added while copying the regex.
     * @param {String} removeFlags List of flags to be removed while copying the regex.
     * @returns {RegExp} A new copy of the regex, possibly with modified flags.
     */
    function copy (regex, addFlags, removeFlags) {
        if (!XRegExp.isRegExp(regex))
            throw new TypeError("type RegExp expected");
        var x = regex._xregexp,
            flags = getNativeFlags(regex) + (addFlags || "");
        if (removeFlags)
            flags = nativ.replace.call(flags, new RegExp("[" + removeFlags + "]+", "g"), ""); // Would need to escape `removeFlags` if this wasn't private
        if (x) {
            // Compiling the current (rather than precompilation) source preserves the effects of nonnative source flags
            regex = XRegExp(regex.source, flags);
            regex._xregexp = {captureNames: x.captureNames ? x.captureNames.slice(0) : null};
        } else {
            // Remove duplicate flags to avoid throwing
            flags = nativ.replace.call(flags, /([\s\S])(?=[\s\S]*\1)/g, "");
            // Don't use `XRegExp`; avoid searching for special tokens and adding special properties
            regex = new RegExp(regex.source, flags);
        }
        return regex;
    }

    /**
     * Copy properties of `b` to `a`.
     * @private
     * @param {Object} a The property-receiving object.
     * @param {Object} b The property-providing object.
     * @returns {Object} The augmented `a` object.
     */
    function extend (a, b) {
        for (var p in b)
            b.hasOwnProperty(p) && (a[p] = b[p]);
        return a;
    }

    function getNativeFlags (regex) {
        //return nativ.exec.call(/\/([a-z]*)$/i, regex + "")[1];
        return (regex.global     ? "g" : "") +
               (regex.ignoreCase ? "i" : "") +
               (regex.multiline  ? "m" : "") +
               (regex.extended   ? "x" : "") + // Proposed for ES4; included in AS3
               (regex.sticky     ? "y" : ""); // Included in Firefox 3+
    }

    function indexOf (array, item, from) {
        if (Array.prototype.indexOf) // Use the native array method if available
            return array.indexOf(item, from);
        for (var i = from || 0; i < array.length; i++) {
            if (array[i] === item)
                return i;
        }
        return -1;
    }

    /**
     * Prepares an options object from the given value.
     * @private
     * @param {Mixed} value The value to convert to an options object.
     * @returns {Object} The options object.
     */
    function prepareOptions (value) {
        value = value || {};
        if (value === "all" || value.all)
            value = {natives: true, methods: true, extensibility: true};
        else if (typeof value === "string")
            value = XRegExp.forEach(value, /[^\s,]+/, function (m) {this[m] = true;}, {});
        return value;
    }

    function runTokens (pattern, index, scope, context) {
        var i = tokens.length,
            result, match, t;
        // Protect against constructing XRegExps within token handler and trigger functions
        isInsideConstructor = true;
        // Must reset `isInsideConstructor`, even if a `trigger` or `handler` throws
        try {
            while (i--) { // Run in reverse order
                t = tokens[i];
                if ((scope & t.scope) && (!t.trigger || t.trigger.call(context))) {
                    t.pattern.lastIndex = index;
                    match = fixed.exec.call(t.pattern, pattern); // Fixed `exec` here allows use of named backreferences, etc.
                    if (match && match.index === index) {
                        result = {
                            output: t.handler.call(context, match, scope),
                            match: match
                        };
                        break;
                    }
                }
            }
        } catch (err) {
            throw err;
        } finally {
            isInsideConstructor = false;
        }
        return result;
    }

    function setExtensibility (on) {
        XRegExp.addToken = addToken[on ? "on" : "off"];
        features.extensibility = on;
    }

    function setMethods (on) {
        if (on) {
            RegExp.prototype.apply = XRegExp.prototype.apply;
            RegExp.prototype.call = XRegExp.prototype.call;
        } else {
            // Restore methods if they existed before XRegExp ran; otherwise delete
            nativ.apply ? RegExp.prototype.apply = nativ.apply : delete RegExp.prototype.apply;
            nativ.call ? RegExp.prototype.call = nativ.call : delete RegExp.prototype.call;
        }
        features.methods = on;
    }

    function setNatives (on) {
        RegExp.prototype.exec = (on ? fixed : nativ).exec;
        RegExp.prototype.test = (on ? fixed : nativ).test;
        String.prototype.match = (on ? fixed : nativ).match;
        String.prototype.replace = (on ? fixed : nativ).replace;
        String.prototype.split = (on ? fixed : nativ).split;
        features.natives = on;
    }


    //---------------------------------
    //  Expose XRegExp
    //---------------------------------

    if (typeof exports === "undefined")
        root.XRegExp = XRegExp; // Create global varable
    else // For CommonJS enviroments
        exports.XRegExp = XRegExp;

}(this));
}


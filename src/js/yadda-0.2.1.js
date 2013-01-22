/*
 * Copyright 2010 Acuminous Ltd / Energized Work Ltd
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

Yadda = {}

// Provides a recursive interface, i.e. new Yadda().yadda().yadda() interface to the Yadda Interpreter
Yadda.yadda = function(libraries, ctx) {

    this.interpreter = new Yadda.Interpreter(libraries);
    var environment = new Yadda.Environment(ctx);
    var before = function() {};
    var after = function() {};

    this.requires = function(libraries) {
        this.interpreter.requires(libraries);
        return this;
    };

    this.yadda = function(script, ctx) {
        if (script == undefined) return this;
        var env = environment.merge(ctx);
        Yadda.Util.bind(env.ctx, before)();
        this.interpreter.interpret(script, env.ctx);
        Yadda.Util.bind(env.ctx, after)();
    }

    this.before = function(fn) {
        before = fn;
        return this;
    }

    this.after = function(fn) {
        after = fn;
        return this;
    }

    this.toString = function() {
        "Yadda 0.2.0 Copyright 2010 Acuminous Ltd / Energized Work Ltd";
    }    
}

// Understands a scenario
Yadda.Interpreter = function(libraries) {

    var libraries = Yadda.Util.ensure_array(libraries);
    var _this = this;

    this.requires = function(libraries) {
        libraries.push_all(libraries);
        return this;
    };

    this.interpret = function(scenario, ctx) {
        Yadda.Util.ensure_array(scenario).each(function(step) { 
            _this.interpret_step(step, ctx);
        });
    };

    this.interpret_step = function(step, ctx) {
        this.competing_macros(step).clear_winner().interpret(step, ctx);
    };  

    this.competing_macros = function(step) {
        return new Yadda.Competition(step, compatible_macros(step));
    };

    var compatible_macros = function(step) {
        return libraries.inject([], function(macros, library) {
            return macros.concat(library.find_compatible_macros(step));
        });
    };
}

// Understands how to index macros
Yadda.Library = function(dictionary) {

    var dictionary = dictionary ? dictionary : new Yadda.Dictionary();
    var macros = Yadda.Util.ensure_array([]);
    var _this = this;    

    this.define = function(signatures, fn, ctx) {
        Yadda.Util.ensure_array(signatures).each(function(signature) {            
            define_macro(signature, fn, ctx);
        });
        return this;        
    };

    var define_macro = function(signature, fn, ctx) {
        if (_this.get_macro(signature)) throw 'Duplicate macro: [' + signature + ']';
        macros.push(new Yadda.Macro(signature, dictionary.expand(signature), fn, ctx));
    }

    this.get_macro = function(signature) {        
        return macros.find(function(other_macro) {
            return other_macro.is_identified_by(signature);
        });
    };

    this.find_compatible_macros = function(step) {
        return macros.find_all(function(macro) {
            return macro.can_interpret(step);
        });
    };
};

// Understands a step
Yadda.Macro = function(signature, signature_pattern, fn, ctx) {    
    
    var _this = this;
    var environment = new Yadda.Environment(ctx);
    var signature_pattern = new Yadda.RegularExpression(signature_pattern);

    var init = function(signature, signature_pattern) {
        _this.signature = normalise(signature);
    }

    this.is_identified_by = function(other_signature) {
        return this.signature == normalise(other_signature);        
    }; 

    this.can_interpret = function(step) {
        return signature_pattern.test(step);
    };  

    this.interpret = function(step, ctx) {    
        var args = signature_pattern.groups(step);
        var env = environment.merge(ctx);
        return Yadda.Util.bind(env.ctx, fn)(args);
    };

    this.levenshtein_signature = function() {
        return signature_pattern.undress();            
    };

    var normalise = function(signature) {
        return new RegExp(signature).toString();
    }

    this.toString = function() {
        return this.signature;
    };

    init(signature, signature_pattern)
};

// Understands definitions of termsxx
Yadda.Dictionary = function(prefix) {

    var prefix = prefix ? prefix : '$';
    var terms = {};
    var term_pattern = new Yadda.RegularExpression(new RegExp('(?:^|[^\\\\])\\' + prefix + '(\\w+)', 'g')); 
    var _this = this;       

    this.define = function(term, definition) {
        if (this.is_defined(term)) throw 'Duplicate definition: [' + term + ']';
        terms[term] = normalise(definition);
        return this;
    };

    this.is_defined = function(term) {
        return terms[term];
    };    

    this.expand = function(term, already_expanding) {
        var already_expanding = Yadda.Util.ensure_array(already_expanding);
        if (!is_expandable(term)) return term;
        return expand_sub_terms(term, already_expanding);
    };

    var expand_sub_terms = function(term, already_expanding) {
        return get_sub_terms(term).each(function(sub_term) {
            if (already_expanding.in_array(sub_term)) throw 'Circular Definition: \[' + already_expanding.join(', ') + '\]'; 
            var sub_term_definition = expand_sub_term(sub_term, already_expanding);
            return term = term.replace(prefix + sub_term, sub_term_definition);
        });
    };

    var get_sub_terms = function(term) {
        return term_pattern.groups(term);
    }

    var expand_sub_term = function(sub_term, already_expanding) {
        var definition = terms[sub_term] ? terms[sub_term] : '(.+)';
        return is_expandable(definition) ? _this.expand(definition, already_expanding.concat(sub_term)) : definition;
    }

    var normalise = function(definition) {
        return definition.toString().replace(/^\/|\/$/g, '');
    }

    var is_expandable = function(definition) {  
        return term_pattern.test(definition);
    };  
};


// Understands a macros execution context
Yadda.Environment = function(ctx) {

    this.ctx = {};
    this._merge_on = 'ctx';

    this.merge = function(other) {
        other = get_item_to_merge(other);
        return new Yadda.Environment(this.ctx)._merge(other);
    }

    var get_item_to_merge = function(other) {
        if (!other) return {};
        return other._merge_on ? other[other._merge_on] : other;
    }

    this._merge = function(other_ctx) {
        for (var key in other_ctx) { this.ctx[key] = other_ctx[key] }; 
        return this;
    }

    this._merge(ctx);
}

// Understands appropriateness of macros
Yadda.Competition = function(step, macros) {

    var results = [];
    var by_ascending_score = function(a, b) { return b.score.beats(a.score); };
    var FIRST_PLACE = 0;
    var SECOND_PLACE = 1;

    this.clear_winner = function() {
        if (number_of_competitors() == 0) throw 'Undefined Step: [' + step + ']';
        if (joint_first_place()) throw 'Ambiguous Step: [' + step + ']';
        return this.winner() 
    };   

    var number_of_competitors = function() {
        return results.length;
    };

    var joint_first_place = function() {
        return (number_of_competitors() > 1) && results[FIRST_PLACE].score.equals(results[SECOND_PLACE].score); 
    };

    this.winner = function() {
        return results[FIRST_PLACE].macro;
    };

    var rank = function(step, macros) {
        results = macros.collect(function(macro) {
            return { macro: macro, score: new Yadda.LevenshteinDistanceScore(step, macro.levenshtein_signature()) }
        }).sort( by_ascending_score );
    };

    rank(step, Yadda.Util.ensure_array(macros));
};

// Understands similarity of two strings
Yadda.LevenshteinDistanceScore = function(s1, s2) {

    this.value;
    this.type = 'LevenshteinDistanceScore';    
    var distanceTable;
    var _this = this;

    var initDistanceTable = function() {

        var x = s1.length;
        var y = s2.length;

        distantce_table = new Array(x + 1);

        for (i = 0; i <= x; i++) {
            distantce_table[i] = new Array(y + 1);
        }

        for (var i = 0; i <= x; i++) {
            for (var j = 0; j <= y; j++) {
                distantce_table[i][j] = 0;
            }
        }

        for (var i = 0; i <= x; i++) {
            distantce_table[i][0] = i;
        }

        for (var j = 0; j <= y; j++) {
            distantce_table[0][j] = j;
        }
    };

    var score = function() {

        if (s1 == s2) return 0;

        var s1_length = s1.length;
        var s2_length = s2.length;

        for (var j = 0; j < s2_length; j++) {
            for (var i = 0; i < s1_length; i++) {
                if (s1[i] == s2[j]) {
                    distantce_table[i+1][j+1] = distantce_table[i][j];
                } else {
                    var deletion = distantce_table[i][j+1] + 1;
                    var insertion = distantce_table[i+1][j] + 1;
                    var substitution = distantce_table[i][j] + 1;
                    distantce_table[i+1][j+1] = Math.min(substitution, deletion, insertion)
                }
            }
        }
        _this.value = distantce_table[s1_length][s2_length];
    };

    this.beats = function(other) {
        return this.value < other.value;
    } 

    this.equals = function(other) {
        if (!other) return false;
        return (this.type == other.type && this.value == other.value);
    }   

    initDistanceTable();
    score();
};

// Wrapper for JavaScript Regular Expressions
Yadda.RegularExpression = function(pattern_or_regexp) {

    var groups_pattern = /(^|[^\\\\])\(.*?\)/g;
    var sets_pattern = /(^|[^\\\\])\[.*?\]/g;
    var repetitions_pattern = /(^|[^\\\\])\{.*?\}/g;
    var regex_aliases_pattern = /(^|[^\\\\])\\./g;
    var non_word_tokens_pattern = /[^\w\s]/g;
    var regexp = new RegExp(pattern_or_regexp);

    this.test = function(text) {
        var result = regexp.test(text);
        this.reset();        
        return result;
    };  

    this.groups = function(text) {
        var results = Yadda.Util.ensure_array([]);
        var match = regexp.exec(text);
        while (match) {
            var groups = match.slice(1, match.length);
            results.push(Array.prototype.slice.call(groups, 0))
            match = regexp.global && regexp.exec(text)
        }
        this.reset();
        return results;        
    };   

    this.reset = function() {
        regexp.lastIndex = 0;
        return this;
    };

    this.undress = function() {
        return regexp.source.replace(groups_pattern, '$1')
                            .replace(sets_pattern, '$1')
                            .replace(repetitions_pattern, '$1')
                            .replace(regex_aliases_pattern, '$1')
                            .replace(non_word_tokens_pattern, '');
    };    

    this.equals = function(other) {
        return this.toString() == other.toString();
    };    

    this.toString = function() {
        return "/" + regexp.source + "/";
    };
};

// Utility functions
Yadda.Util = {
    ensure_array: function(obj) {
        var array = obj ? [].concat(obj) : [];
        array.ensure_array = this.curry(array, this.ensure_array);
        array.in_array = this.curry(array, this.in_array, array);
        array.each = this.curry(array, this.each, array);
        array.collect = this.curry(array, this.collect, array);
        array.inject = this.curry(array, this.inject, array);
        array.push_all = this.curry(array, this.push_all, array);
        array.find_all = this.curry(array, this.find_all, array);
        array.find = this.curry(array, this.find, array);
        array.curry = this.curry(array, this.curry);
        return array;
    },

    in_array: function(items, item) {

        var found = false;
        for (var i = 0; i < items.length; i++) {
            if (items[i] == item) {
                found = true;
                break;
            }
        }

        return found;
    },    

    each: function(items, fn) { 
        var result;
        for (var i = 0; i < items.length; i++) {
            result = fn(items[i]);
        };
        return result;
    },

    collect: function(items, fn) {
        var results = [];
        for (var i = 0; i < items.length; i++) {
            results.push(fn(items[i]));
        }
        return results;
    },

    inject: function(items, default_value, fn) {
        var result = default_value;
        for (var i = 0; i < items.length; i++) {
            result = fn(result, items[i]);            
        }
        return result;
    },

    push_all: function(items, more_items) {
        var more_items = more_items ? [].concat(more_items) : [];
        for (var i = 0; i < more_items.length; i++) {
            items.push(more_items[i]);
        }        
    },

    find_all: function(items, test) {
        var results = this.ensure_array([]);
        for (var i = 0; i < items.length; i++) {
            if (test(items[i])) {
                results.push(items[i]);
            }
        }
        return results;
    },

    find: function(items, test) {        
        var result;
        for (var i = 0; i < items.length; i++) {
            if (test(items[i])) {
                result = items[i];                
                break;
            }
        };
        return result;
    },

    curry: function(ctx, fn) {
        var slice = Array.prototype.slice;
        var args = slice.apply(arguments, [2]);
        return function() {
            return fn.apply(ctx, args.concat(slice.apply(arguments)));
        }
    },

    bind: function(ctx, fn) {
        return function() {
            var args = arguments.length > 0 ? arguments[0] : [];
            return fn.apply(ctx, args[0]);
        };
    }    
}
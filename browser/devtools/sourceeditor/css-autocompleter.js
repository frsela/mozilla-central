/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const { Cc, Ci, Cu } = require('chrome');
const cssTokenizer  = require("devtools/sourceeditor/css-tokenizer");
const promise = Cu.import("resource://gre/modules/Promise.jsm");

/**
 * Here is what this file (+ ./css-tokenizer.js) do.
 *
 * The main objective here is to provide as much suggestions to the user editing
 * a stylesheet in Style Editor. The possible things that can be suggested are:
 *  - CSS property names
 *  - CSS property values
 *  - CSS Selectors
 *  - Some other known CSS keywords
 *
 * Gecko provides a list of both property names and their corresponding values.
 * We take out a list of matching selectors using the Inspector actor's
 * `getSuggestionsForQuery` method. Now the only thing is to parse the CSS being
 * edited by the user, figure out what token or word is being written and last
 * but the most difficult, what is being edited.
 *
 * The file 'css-tokenizer' helps in converting the CSS into meaningful tokens,
 * each having a certain type associated with it. These tokens help us to figure
 * out the currently edited word and to write a CSS state machine to figure out
 * what the user is currently editing. By that, I mean, whether he is editing a
 * selector or a property or a value, or even fine grained information like an
 * id in the selector.
 *
 * The `resolveState` method iterated over the tokens spitted out by the
 * tokenizer, using switch cases, follows a state machine logic and finally
 * figures out these informations:
 *  - The state of the CSS at the cursor (one out of CSS_STATES)
 *  - The current token that is being edited `cmpleting`
 *  - If the state is "selector", the selector state (one of SELECTOR_STATES)
 *  - If the state is "selector", the current selector till the cursor
 *  - If the state is "value", the corresponding property name
 *
 * In case of "value" and "property" states, we simply use the information
 * provided by Gecko to filter out the possible suggestions.
 * For "selector" state, we request the Inspector actor to query the page DOM
 * and filter out the possible suggestions.
 * For "media" and "keyframes" state, the only possible suggestions for now are
 * "media" and "keyframes" respectively, although "media" can have suggestions
 * like "max-width", "orientation" etc. Similarly "value" state can also have
 * much better logical suggestions if we fine grain identify a sub state just
 * like we do for the "selector" state.
 */

// Autocompletion types.

const CSS_STATES = {
  "null": "null",
  property: "property",    // foo { bar|: … }
  value: "value",          // foo {bar: baz|}
  selector: "selector",    // f| {bar: baz}
  media: "media",          // @med| , or , @media scr| { }
  keyframes: "keyframes",  // @keyf|
  frame: "frame",          // @keyframs foobar { t|
};

const SELECTOR_STATES = {
  "null": "null",
  id: "id",                // #f|
  class: "class",          // #foo.b|
  tag: "tag",              // fo|
  pseudo: "pseudo",        // foo:|
  attribute: "attribute",  // foo[b|
  value: "value",          // foo[bar=b|
};

const { properties, propertyNames } = getCSSKeywords();

/**
 * Constructor for the autocompletion object.
 *
 * @param options {Object} An options object containing the following options:
 *        - walker {Object} The object used for query selecting from the current
 *                 target's DOM.
 *        - maxEntries {Number} Maximum selectors suggestions to display.
 */
function CSSCompleter(options = {}) {
  this.walker = options.walker;
  this.maxEntries = options.maxEntries || 15;

  // Array containing the [line, ch, scopeStack] for the locations where the
  // CSS state is "null"
  this.nullStates = [];
}

CSSCompleter.prototype = {

  /**
   * Returns a list of suggestions based on the caret position.
   *
   * @param source {String} String of the source code.
   * @param caret {Object} Cursor location with line and ch properties.
   *
   * @returns [{object}] A sorted list of objects containing the following
   *          peroperties:
   *          - label {String} Full keyword for the suggestion
   *          - preLabel {String} Already entered part of the label
   */
  complete: function(source, caret) {
    // Getting the context from the caret position.
    if (!this.resolveState(source, caret)) {
      // We couldn't resolve the context, we won't be able to complete.
      return Promise.resolve([]);
    }

    // Properly suggest based on the state.
    switch(this.state) {
      case CSS_STATES.property:
        return this.completeProperties(this.completing);

      case CSS_STATES.value:
        return this.completeValues(this.propertyName, this.completing);

      case CSS_STATES.selector:
        return this.suggestSelectors();

      case CSS_STATES.media:
      case CSS_STATES.keyframes:
        if ("media".startsWith(this.completing)) {
          return Promise.resolve([{
            label: "media",
            preLabel: this.completing
          }]);
        } else if ("keyframes".startsWith(this.completing)) {
          return Promise.resolve([{
            label: "keyrames",
            preLabel: this.completing
          }]);
        }
    }
    return Promise.resolve([]);
  },

  /**
   * Resolves the state of CSS at the cursor location. This method implements a
   * custom written CSS state machine. The various switch statements provide the
   * transition rules for the state. It also finds out various informatino about
   * the nearby CSS like the property name being completed, the complete
   * selector, etc.
   *
   * @param source {String} String of the source code.
   * @param caret {Object} Cursor location with line and ch properties.
   *
   * @returns CSS_STATE
   *          One of CSS_STATE enum or null if the state cannot be resolved.
   */
  resolveState: function(source, {line, ch}) {
    // Function to return the last element of an array
    let peek = arr => arr[arr.length - 1];
    // _state can be one of CSS_STATES;
    let _state = CSS_STATES.null;
    let selector = "";
    let selectorState = SELECTOR_STATES.null;
    let propertyName = null;
    let scopeStack = [];
    let selectors = [];

    // Fetch the closest null state line, ch from cached null state locations
    let matchedStateIndex = this.findNearestNullState(line);
    if (matchedStateIndex > -1) {
      let state = this.nullStates[matchedStateIndex];
      line -= state[0];
      if (line == 0)
        ch -= state[1];
      source = source.split("\n").slice(state[0]);
      source[0] = source[0].slice(state[1]);
      source = source.join("\n");
      scopeStack = [...state[2]];
      this.nullStates.length = matchedStateIndex + 1;
    }
    else {
      this.nullStates = [];
    }
    let tokens = cssTokenizer(source, {loc:true});
    let tokIndex = tokens.length - 1;
    if (tokens[tokIndex].loc.end.line < line ||
       (tokens[tokIndex].loc.end.line === line &&
        tokens[tokIndex].loc.end.column < ch)) {
      // If the last token is not an EOF, we didn't tokenize it correctly.
      // This special case is handled in case we couldn't tokenize, but the last
      // token that *could be tokenized* was an identifier.
      return null;
    }
    // Since last token is EOF, the cursor token is last - 1
    tokIndex--;

    let cursor = 0;
    // This will maintain a stack of paired elements like { & }, @m & }, : & ; etc
    let token = null;
    let selectorBeforeNot = null;
    while (cursor <= tokIndex && (token = tokens[cursor++])) {
      switch (_state) {
        case CSS_STATES.property:
          // From CSS_STATES.property, we can either go to CSS_STATES.value state
          // when we hit the first ':' or CSS_STATES.selector if "}" is reached.
          switch(token.tokenType) {
            case ":":
              scopeStack.push(":");
              if (tokens[cursor - 2].tokenType != "WHITESPACE")
                propertyName = tokens[cursor - 2].value;
              else
                propertyName = tokens[cursor - 3].value;
              _state = CSS_STATES.value;
              break;

            case "}":
              if (/[{f]/.test(peek(scopeStack))) {
                let popped = scopeStack.pop();
                if (popped == "f") {
                  _state = CSS_STATES.frame;
                } else {
                  selector = "";
                  selectors = [];
                  _state = CSS_STATES.null;
                }
              }
              break;
          }
          break;

        case CSS_STATES.value:
          // From CSS_STATES.value, we can go to one of CSS_STATES.property,
          // CSS_STATES.frame, CSS_STATES.selector and CSS_STATES.null
          switch(token.tokenType) {
            case ";":
              if (/[:]/.test(peek(scopeStack))) {
                scopeStack.pop();
                _state = CSS_STATES.property;
              }
              break;

            case "}":
              if (peek(scopeStack) == ":")
                scopeStack.pop();

              if (/[{f]/.test(peek(scopeStack))) {
                let popped = scopeStack.pop();
                if (popped == "f") {
                  _state = CSS_STATES.frame;
                } else {
                  selector = "";
                  selectors = [];
                  _state = CSS_STATES.null;
                }
              }
              break;
          }
          break;

        case CSS_STATES.selector:
          // From CSS_STATES.selector, we can only go to CSS_STATES.property when
          // we hit "{"
          if (token.tokenType == "{") {
            scopeStack.push("{");
            _state = CSS_STATES.property;
            selectors.push(selector);
            selector = "";
            break;
          }
          switch(selectorState) {
            case SELECTOR_STATES.id:
            case SELECTOR_STATES.class:
            case SELECTOR_STATES.tag:
              switch(token.tokenType) {
                case "HASH":
                  selectorState = SELECTOR_STATES.id;
                  selector += "#" + token.value;
                  break;

                case "DELIM":
                  if (token.value == ".") {
                    selectorState = SELECTOR_STATES.class;
                    selector += ".";
                    if (cursor <= tokIndex &&
                        tokens[cursor].tokenType == "IDENT") {
                      token = tokens[cursor++];
                      selector += token.value;
                    }
                  } else if (token.value == "#") {
                    selectorState = SELECTOR_STATES.id;
                    selector += "#";
                  } else if (/[>~+]/.test(token.value)) {
                    selectorState = SELECTOR_STATES.null;
                    selector += token.value;
                  } else if (token.value == ",") {
                    selectorState = SELECTOR_STATES.null;
                    selectors.push(selector);
                    selector = "";
                  }
                  break;

                case ":":
                  selectorState = SELECTOR_STATES.pseudo;
                  selector += ":";
                  if (cursor > tokIndex)
                    break;

                  token = tokens[cursor++];
                  switch(token.tokenType) {
                    case "FUNCTION":
                      if (token.value == "not") {
                        selectorBeforeNot = selector;
                        selector = "";
                        scopeStack.push("(");
                      } else {
                        selector += token.value + "(";
                      }
                      selectorState = SELECTOR_STATES.null;
                      break;

                    case "IDENT":
                      selector += token.value;
                      break;
                  }
                  break;

                case "[":
                  selectorState = SELECTOR_STATES.attribute;
                  scopeStack.push("[");
                  selector += "[";
                  break;

                case ")":
                  if (peek(scopeStack) == "(") {
                    scopeStack.pop();
                    selector = selectorBeforeNot + "not(" + selector + ")";
                    selectorBeforeNot = null;
                  } else {
                    selector += ")";
                  }
                  selectorState = SELECTOR_STATES.null;
                  break;

                case "WHITESPACE":
                  selectorState = SELECTOR_STATES.null;
                  selector && (selector += " ");
                  break;
              }
              break;

            case SELECTOR_STATES.null:
              // From SELECTOR_STATES.null state, we can go to one of
              // SELECTOR_STATES.id, SELECTOR_STATES.class or SELECTOR_STATES.tag
              switch(token.tokenType) {
                case "HASH":
                  selectorState = SELECTOR_STATES.id;
                  selector += "#" + token.value;
                  break;

                case "IDENT":
                  selectorState = SELECTOR_STATES.tag;
                  selector += token.value;
                  break;

                case "DELIM":
                  if (token.value == ".") {
                    selectorState = SELECTOR_STATES.class;
                    selector += ".";
                    if (cursor <= tokIndex &&
                        tokens[cursor].tokenType == "IDENT") {
                      token = tokens[cursor++];
                      selector += token.value;
                    }
                  } else if (token.value == "#") {
                    selectorState = SELECTOR_STATES.id;
                    selector += "#";
                  } else if (token.value == "*") {
                    selectorState = SELECTOR_STATES.tag;
                    selector += "*";
                  } else if (/[>~+]/.test(token.value)) {
                    selector += token.value;
                  } else if (token.value == ",") {
                    selectorState = SELECTOR_STATES.null;
                    selectors.push(selector);
                    selector = "";
                  }
                  break;

                case ":":
                  selectorState = SELECTOR_STATES.pseudo;
                  selector += ":";
                  if (cursor > tokIndex)
                    break;

                  token = tokens[cursor++];
                  switch(token.tokenType) {
                    case "FUNCTION":
                      if (token.value == "not") {
                        selectorBeforeNot = selector;
                        selector = "";
                        scopeStack.push("(");
                      } else {
                        selector += token.value + "(";
                      }
                      selectorState = SELECTOR_STATES.null;
                      break;

                    case "IDENT":
                      selector += token.value;
                      break;
                  }
                  break;

                case "[":
                  selectorState = SELECTOR_STATES.attribute;
                  scopeStack.push("[");
                  selector += "[";
                  break;

                case ")":
                  if (peek(scopeStack) == "(") {
                    scopeStack.pop();
                    selector = selectorBeforeNot + "not(" + selector + ")";
                    selectorBeforeNot = null;
                  } else {
                    selector += ")";
                  }
                  selectorState = SELECTOR_STATES.null;
                  break;

                case "WHITESPACE":
                  selector && (selector += " ");
                  break;
              }
              break;

            case SELECTOR_STATES.pseudo:
              switch(token.tokenType) {
                case "DELIM":
                  if (/[>~+]/.test(token.value)) {
                    selectorState = SELECTOR_STATES.null;
                    selector += token.value;
                  } else if (token.value == ",") {
                    selectorState = SELECTOR_STATES.null;
                    selectors.push(selector);
                    selector = "";
                  }
                  break;

                case ":":
                  selectorState = SELECTOR_STATES.pseudo;
                  selector += ":";
                  if (cursor > tokIndex)
                    break;

                  token = tokens[cursor++];
                  switch(token.tokenType) {
                    case "FUNCTION":
                      if (token.value == "not") {
                        selectorBeforeNot = selector;
                        selector = "";
                        scopeStack.push("(");
                      } else {
                        selector += token.value + "(";
                      }
                      selectorState = SELECTOR_STATES.null;
                      break;

                    case "IDENT":
                      selector += token.value;
                      break;
                  }
                  break;

                case "[":
                  selectorState = SELECTOR_STATES.attribute;
                  scopeStack.push("[");
                  selector += "[";
                  break;

                case "WHITESPACE":
                  selectorState = SELECTOR_STATES.null;
                  selector && (selector += " ");
                  break;
              }
              break;

            case SELECTOR_STATES.attribute:
              switch(token.tokenType) {
                case "DELIM":
                  if (/[~|^$*]/.test(token.value)) {
                    selector += token.value;
                    token = tokens[cursor++];
                  }
                  if(token.value == "=") {
                    selectorState = SELECTOR_STATES.value;
                    selector += token.value;
                  }
                  break;

                case "IDENT":
                case "STRING":
                  selector += token.value;
                  break;

                case "]":
                  if (peek(scopeStack) == "[")
                    scopeStack.pop();

                  selectorState = SELECTOR_STATES.null;
                  selector += "]";
                  break;

                case "WHITESPACE":
                  selector && (selector += " ");
                  break;
              }
              break;

            case SELECTOR_STATES.value:
              switch(token.tokenType) {
                case "STRING":
                case "IDENT":
                  selector += token.value;
                  break;

                case "]":
                  if (peek(scopeStack) == "[")
                    scopeStack.pop();

                  selectorState = SELECTOR_STATES.null;
                  selector += "]";
                  break;

                case "WHITESPACE":
                  selector && (selector += " ");
                  break;
              }
              break;
          }
          break;

        case CSS_STATES.null:
          // From CSS_STATES.null state, we can go to either CSS_STATES.media or
          // CSS_STATES.selector.
          switch(token.tokenType) {
            case "HASH":
              selectorState = SELECTOR_STATES.id;
              selector = "#" + token.value;
              _state = CSS_STATES.selector;
              break;

            case "IDENT":
              selectorState = SELECTOR_STATES.tag;
              selector = token.value;
              _state = CSS_STATES.selector;
              break;

            case "DELIM":
              if (token.value == ".") {
                selectorState = SELECTOR_STATES.class;
                selector = ".";
                _state = CSS_STATES.selector;
                if (cursor <= tokIndex &&
                    tokens[cursor].tokenType == "IDENT") {
                  token = tokens[cursor++];
                  selector += token.value;
                }
              } else if (token.value == "#") {
                selectorState = SELECTOR_STATES.id;
                selector = "#";
                _state = CSS_STATES.selector;
              } else if (token.value == "*") {
                selectorState = SELECTOR_STATES.tag;
                selector = "*";
                _state = CSS_STATES.selector;
              }
              break;

            case ":":
              _state = CSS_STATES.selector;
              selectorState = SELECTOR_STATES.pseudo;
              selector += ":";
              if (cursor > tokIndex)
                break;

              token = tokens[cursor++];
              switch(token.tokenType) {
                case "FUNCTION":
                  if (token.value == "not") {
                    selectorBeforeNot = selector;
                    selector = "";
                    scopeStack.push("(");
                  } else {
                    selector += token.value + "(";
                  }
                  selectorState = SELECTOR_STATES.null;
                  break;

                case "IDENT":
                  selector += token.value;
                  break;
              }
              break;

            case "[":
              _state = CSS_STATES.selector;
              selectorState = SELECTOR_STATES.attribute;
              scopeStack.push("[");
              selector += "[";
              break;

            case "AT-KEYWORD":
              _state = token.value.startsWith("m") ? CSS_STATES.media
                                                   : CSS_STATES.keyframes;
              break;

            case "}":
              if (peek(scopeStack) == "@m")
                scopeStack.pop();

              break;
          }
          break;

        case CSS_STATES.media:
          // From CSS_STATES.media, we can only go to CSS_STATES.null state when
          // we hit the first '{'
          if (token.tokenType == "{") {
            scopeStack.push("@m");
            _state = CSS_STATES.null;
          }
          break;

        case CSS_STATES.keyframes:
          // From CSS_STATES.keyframes, we can only go to CSS_STATES.frame state
          // when we hit the first '{'
          if (token.tokenType == "{") {
            scopeStack.push("@k");
            _state = CSS_STATES.frame;
          }
          break;

        case CSS_STATES.frame:
          // From CSS_STATES.frame, we can either go to CSS_STATES.property state
          // when we hit the first '{' or to CSS_STATES.selector when we hit '}'
          if (token.tokenType == "{") {
            scopeStack.push("f");
            _state = CSS_STATES.property;
          } else if (token.tokenType == "}") {
            if (peek(scopeStack) == "@k")
              scopeStack.pop();

            _state = CSS_STATES.null;
          }
          break;
      }
      if (_state == CSS_STATES.null) {
        if (this.nullStates.length == 0) {
          this.nullStates.push([token.loc.end.line, token.loc.end.column,
                                [...scopeStack]]);
          continue;
        }
        let tokenLine = token.loc.end.line;
        let tokenCh = token.loc.end.column;
        if (tokenLine == 0)
          continue;
        if (matchedStateIndex > -1)
          tokenLine += this.nullStates[matchedStateIndex][0];
        this.nullStates.push([tokenLine, tokenCh, [...scopeStack]]);
      }
    }
    this.state = _state;
    this.propertyName = _state == CSS_STATES.value ? propertyName : null;
    this.selectorState = _state == CSS_STATES.selector ? selectorState : null;
    this.selectorBeforeNot = selectorBeforeNot == null ? null: selectorBeforeNot;
    if (token) {
      selector = selector.slice(0, selector.length + token.loc.end.column - ch);
      this.selector = selector;
    }
    else {
      this.selector = "";
    }
    this.selectors = selectors;

    if (token && token.tokenType != "WHITESPACE") {
      this.completing = ((token.value || token.repr || token.tokenType) + "")
                          .slice(0, ch - token.loc.start.column)
                          .replace(/^[.#]$/, "");
    } else {
      this.completing = "";
    }
    // Special case the situation when the user just entered ":" after typing a
    // property name.
    if (this.completing == ":" && _state == CSS_STATES.value)
      this.completing = "";

    // Special check for !important; case.
    if (token && tokens[cursor - 2] && tokens[cursor - 2].value == "!" &&
        this.completing == "important".slice(0, this.completing.length)) {
      this.completing = "!" + this.completing;
    }
    return _state;
  },

  /**
   * Queries the DOM Walker actor for suggestions regarding the selector being
   * completed
   */
  suggestSelectors: function () {
    let walker = this.walker;
    if (!walker)
      return Promise.resolve([]);

    let query = this.selector;
    // Even though the selector matched atleast one node, there is still
    // possibility of suggestions.
    switch(this.selectorState) {
      case SELECTOR_STATES.null:
        query += "*";
        break;

      case SELECTOR_STATES.tag:
        query = query.slice(0, query.length - this.completing.length);
        break;

      case SELECTOR_STATES.id:
      case SELECTOR_STATES.class:
      case SELECTOR_STATES.pseudo:
        if (/^[.:#]$/.test(this.completing)) {
          query = query.slice(0, query.length - this.completing.length);
          this.completing = "";
        } else {
          query = query.slice(0, query.length - this.completing.length - 1);
        }
        break;
    }

    if (/[\s+>~]$/.test(query) &&
        this.selectorState != SELECTOR_STATES.attribute &&
        this.selectorState != SELECTOR_STATES.value) {
      query += "*";
    }

    // Set the values that this request was supposed to suggest to.
    this._currentQuery = query;
    return walker.getSuggestionsForQuery(query, this.completing, this.selectorState)
                 .then(result => this.prepareSelectorResults(result));
  },

 /**
  * Prepares the selector suggestions returned by the walker actor.
  */
  prepareSelectorResults: function(result) {
    if (this._currentQuery != result.query)
      return [];

    result = result.suggestions;
    let query = this.selector;
    let completion = [];
    for (let value of result) {
      switch(this.selectorState) {
        case SELECTOR_STATES.id:
        case SELECTOR_STATES.class:
        case SELECTOR_STATES.pseudo:
          if (/^[.:#]$/.test(this.completing)) {
            value[0] = query.slice(0, query.length - this.completing.length) +
                       value[0];
          } else {
            value[0] = query.slice(0, query.length - this.completing.length - 1) +
                       value[0];
          }
          break;

        case SELECTOR_STATES.tag:
          value[0] = query.slice(0, query.length - this.completing.length) +
                     value[0];
          break;

        case SELECTOR_STATES.null:
          value[0] = query + value[0];
          break;

        default:
         value[0] = query.slice(0, query.length - this.completing.length) +
                    value[0];
      }
      completion.push({
        label: value[0],
        preLabel: query,
        score: value[1]
      });
      if (completion.length > this.maxEntries - 1)
        break;
    }
    return completion;
  },

  /**
   * Returns CSS property name suggestions based on the input.
   *
   * @param startProp {String} Initial part of the property being completed.
   */
  completeProperties: function(startProp) {
    let finalList = [];
    if (!startProp)
      return Promise.resolve(finalList);

    let length = propertyNames.length;
    let i = 0, count = 0;
    for (; i < length && count < this.maxEntries; i++) {
      if (propertyNames[i].startsWith(startProp)) {
        count++;
        finalList.push({
          preLabel: startProp,
          label: propertyNames[i]
        });
      } else if (propertyNames[i] > startProp) {
        // We have crossed all possible matches alphabetically.
        break;
      }
    }
    return Promise.resolve(finalList);
  },

  /**
   * Returns CSS value suggestions based on the corresponding property.
   *
   * @param propName {String} The property to which the value being completed
   *        belongs.
   * @param startValue {String} Initial part of the value being completed.
   */
  completeValues: function(propName, startValue) {
    let finalList = [];
    let list = ["!important;", ...(properties[propName] || [])];
    // If there is no character being completed, we are showing an initial list
    // of possible values. Skipping '!important' in this case.
    if (!startValue)
      list.splice(0, 1);

    let length = list.length;
    let i = 0, count = 0;
    for (; i < length && count < this.maxEntries; i++) {
      if (list[i].startsWith(startValue)) {
        count++;
        finalList.push({
          preLabel: startValue,
          label: list[i]
        });
      } else if (list[i] > startValue) {
        // We have crossed all possible matches alphabetically.
        break;
      }
    }
    return Promise.resolve(finalList);
  },

  /**
   * A biased binary search in a sorted array where the middle element is
   * calculated based on the values at the lower and the upper index in each
   * iteration.
   *
   * This method returns the index of the closest null state from the passed
   * `line` argument. Once we have the closest null state, we can start applying
   * the state machine logic from that location instead of the absolute starting
   * of the CSS source. This speeds up the tokenizing and the state machine a
   * lot while using autocompletion at high line numbers in a CSS source.
   */
  findNearestNullState: function(line) {
    let arr = this.nullStates;
    let high = arr.length - 1;
    let low = 0;
    let target = 0;

    if (high < 0)
      return -1;
    if (arr[high][0] <= line)
      return high;
    if (arr[low][0] > line)
      return -1;

    while (high > low) {
      if (arr[low][0] <= line && arr[low [0]+ 1] > line)
        return low;
      if (arr[high][0] > line && arr[high - 1][0] <= line)
        return high - 1;

      target = (((line - arr[low][0]) / (arr[high][0] - arr[low][0])) *
                (high - low)) | 0;

      if (arr[target][0] <= line && arr[target + 1][0] > line) {
        return target;
      } else if (line > arr[target][0]) {
        low = target + 1;
        high--;
      } else {
        high = target - 1;
        low++;
      }
    }

    return -1;
  },

  /**
   * Invalidates the state cache for and above the line.
   */
  invalidateCache: function(line) {
    this.nullStates.length = this.findNearestNullState(line) + 1;
  },

  /**
   * Get the state information about a token surrounding the {line, ch} position
   *
   * @param {string} source
   *        The complete source of the CSS file. Unlike resolve state method,
   *        this method requires the full source.
   * @param {object} caret
   *        The line, ch position of the caret.
   *
   * @returns {object}
   *          An object containing the state of token covered by the caret.
   *          The object has following properties when the the state is
   *          "selector", "value" or "property", null otherwise:
   *           - state {string} one of CSS_STATES - "selector", "value" etc.
   *           - selector {string} The selector at the caret when `state` is
   *                      selector. OR
   *           - selectors {[string]} Array of selector strings in case when
   *                       `state` is "value" or "property"
   *           - propertyName {string} The property name at the current caret or
   *                          the property name corresponding to the value at
   *                          the caret.
   *           - value {string} The css value at the current caret.
   *           - loc {object} An object containing the starting and the ending
   *                 caret position of the whole selector, value or property.
   *                  - { start: {line, ch}, end: {line, ch}}
   */
  getInfoAt: function(source, caret) {
    // Limits the input source till the {line, ch} caret position
    function limit(source, {line, ch}) {
      line++;
      let list = source.split("\n");
      if (list.length < line)
        return source;
      if (line == 1)
        return list[0].slice(0, ch);
      return [...list.slice(0, line - 1), list[line - 1].slice(0, ch)].join("\n");
    }

    // Get the state at the given line, ch
    let state = this.resolveState(limit(source, caret), caret);
    let propertyName = this.propertyName;
    let {line, ch} = caret;
    let sourceArray = source.split("\n");
    let limitedSource = limit(source, caret);

    /**
     * Method to traverse forwards from the caret location to figure out the
     * ending point of a selector or css value.
     *
     * @param {function} check
     *        A method which takes the current state as an input and determines
     *        whether the state changed or not.
     */
    let traverseForward = check => {
      let location;
      // Backward loop to determine the beginning location of the selector.
      do {
        let lineText = sourceArray[line];
        if (line == caret.line)
          lineText = lineText.substring(caret.ch);

        let tokens = cssTokenizer(lineText, {loc: true});
        let found = false;
        let ech = line == caret.line ? caret.ch : 0;
        for (let i = 0; i < tokens.length; i++) {
          let token = tokens[i];
          // If the line is completely spaces, handle it differently
          if (lineText.trim() == "") {
            limitedSource += lineText;
          } else {
            limitedSource += sourceArray[line]
                              .substring(ech + token.loc.start.column,
                                         ech + token.loc.end.column);
          }

          // Whitespace cannot change state.
          if (token.tokenType == "WHITESPACE")
            continue;

          let state = this.resolveState(limitedSource, {
            line: line,
            ch: token.loc.end.column + ech
          });
          if (check(state)) {
            if (tokens[i - 1] && tokens[i - 1].tokenType == "WHITESPACE")
              token = tokens[i - 1];
            location = {
              line: line,
              ch: token.loc.start.column + ech
            };
            found = true;
            break;
          }
        }
        limitedSource += "\n";
        if (found)
          break;
      } while (line++ < sourceArray.length);
      return location;
    };

    /**
     * Method to traverse backwards from the caret location to figure out the
     * starting point of a selector or css value.
     *
     * @param {function} check
     *        A method which takes the current state as an input and determines
     *        whether the state changed or not.
     * @param {boolean} isValue
     *        true if the traversal is being done for a css value state.
     */
    let traverseBackwards = (check, isValue) => {
      let location;
      // Backward loop to determine the beginning location of the selector.
      do {
        let lineText = sourceArray[line];
        if (line == caret.line)
          lineText = lineText.substring(0, caret.ch);

        let tokens = cssTokenizer(lineText, {loc: true});
        let found = false;
        let ech = 0;
        for (let i = tokens.length - 2; i >= 0; i--) {
          let token = tokens[i];
          // If the line is completely spaces, handle it differently
          if (lineText.trim() == "") {
            limitedSource = limitedSource.slice(0, -1 * lineText.length);
          } else {
            let length = token.loc.end.column - token.loc.start.column;
            limitedSource = limitedSource.slice(0, -1 * length);
          }

          // Whitespace cannot change state.
          if (token.tokenType == "WHITESPACE")
            continue;

          let state = this.resolveState(limitedSource, {
            line: line,
            ch: token.loc.start.column
          });
          if (check(state)) {
            if (tokens[i + 1] && tokens[i + 1].tokenType == "WHITESPACE")
              token = tokens[i + 1];
            location = {
              line: line,
              ch: isValue ? token.loc.end.column: token.loc.start.column
            };
            found = true;
            break;
          }
        }
        limitedSource = limitedSource.slice(0, -1);
        if (found)
          break;
      } while (line-- >= 0);
      return location;
    };

    if (state == CSS_STATES.selector) {
      // For selector state, the ending and starting point of the selector is
      // either when the state changes or the selector becomes empty and a
      // single selector can span multiple lines.
      // Backward loop to determine the beginning location of the selector.
      let start = traverseBackwards(state => {
        return (state != CSS_STATES.selector ||
               (this.selector == "" && this.selectorBeforeNot == null));
      });

      line = caret.line;
      limitedSource = limit(source, caret);
      // Forward loop to determine the ending location of the selector.
      let end = traverseForward(state => {
        return (state != CSS_STATES.selector ||
               (this.selector == "" && this.selectorBeforeNot == null));
      });

      // Since we have start and end positions, figure out the whole selector.
      let selector = source.split("\n").slice(start.line, end.line + 1);
      selector[selector.length - 1] =
        selector[selector.length - 1].substring(0, end.ch);
      selector[0] = selector[0].substring(start.ch);
      selector = selector.join("\n");
      return {
        state: state,
        selector: selector,
        loc: {
          start: start,
          end: end
        }
      };
    }
    else if (state == CSS_STATES.property) {
      // A property can only be a single word and thus very easy to calculate.
      let tokens = cssTokenizer(sourceArray[line], {loc: true});
      for (let token of tokens) {
        if (token.loc.start.column <= ch && token.loc.end.column >= ch) {
          return {
            state: state,
            propertyName: token.value,
            selectors: this.selectors,
            loc: {
              start: {
                line: line,
                ch: token.loc.start.column
              },
              end: {
                line: line,
                ch: token.loc.end.column
              }
            }
          };
        }
      }
    }
    else if (state == CSS_STATES.value) {
      // CSS value can be multiline too, so we go forward and backwards to
      // determine the bounds of the value at caret
      let start = traverseBackwards(state => state != CSS_STATES.value, true);

      line = caret.line;
      limitedSource = limit(source, caret);
      let end = traverseForward(state => state != CSS_STATES.value);

      let value = source.split("\n").slice(start.line, end.line + 1);
      value[value.length - 1] = value[value.length - 1].substring(0, end.ch);
      value[0] = value[0].substring(start.ch);
      value = value.join("\n");
      return {
        state: state,
        propertyName: propertyName,
        selectors: this.selectors,
        value: value,
        loc: {
          start: start,
          end: end
        }
      };
    }
    return null;
  }
}

/**
 * Returns a list of all property names and a map of property name vs possible
 * CSS values provided by the Gecko engine.
 *
 * @return {Object} An object with following properties:
 *         - propertyNames {Array} Array of string containing all the possible
 *                         CSS property names.
 *         - properties {Object|Map} A map where key is the property name and
 *                      value is an array of string containing all the possible
 *                      CSS values the property can have.
 */
function getCSSKeywords() {
  let domUtils = Cc["@mozilla.org/inspector/dom-utils;1"]
                   .getService(Ci.inIDOMUtils);
  let props = {};
  let propNames = domUtils.getCSSPropertyNames(domUtils.INCLUDE_ALIASES);
  propNames.forEach(prop => {
    props[prop] = domUtils.getCSSValuesForProperty(prop).sort();
  });
  return {
    properties: props,
    propertyNames: propNames.sort()
  };
}

module.exports = CSSCompleter;

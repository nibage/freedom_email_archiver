/* PostalMime 4.2.0 | MIT-0 | bundled CommonJS, no eval */
(function(g){const modules={"./address-parser.js":function(module,exports,require){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const decode_strings_js_1 = require("./decode-strings.js");
/** The token is an operator, a text run otherwise */
const TOKEN_OPERATOR = 1;
/** The next character continues the same run without whitespace in between */
const TOKEN_NO_BREAK = 2;
/** The text run holds characters its value leaves out or changes, so it is no plain slice */
const TOKEN_DIRTY = 4;
/** A backslash escapes the next character in the text run, inside a quoted string or a comment */
const TOKEN_ESCAPES = 8;
/** The text run opens on a character an escaping backslash in front of it has escaped */
const TOKEN_STARTS_ESCAPED = 16;
/**
 * The tokens of an address field, kept as offsets into it.
 *
 * Every token used to be an object of its own, an operator for every ',' and a value string
 * for every run of text, and a list of one letter names, 'a,a,a,...', took some 65 times its
 * size in tokens before any address was read. A token is now three numbers in one typed
 * array, its kind and the range of the field it covers, and its value is sliced off the field
 * when it is read. The few text runs whose value differs from their slice, as they hold an
 * escaping backslash, a line break or a control character, are rebuilt once and kept aside.
 */
class TokenList {
    constructor(str) {
        this.str = str;
        this.slots = new Int32Array(48);
        this.length = 0;
        this.cleaned = new Map();
    }
    /**
     * Appends a token
     *
     * @param kind Kind and flags of the token
     * @param start Offset of its first character
     * @param end Offset just past its last character
     * @return Index of the token
     */
    push(kind, start, end) {
        if ((this.length + 1) * 3 > this.slots.length) {
            const grown = new Int32Array(this.slots.length * 2);
            grown.set(this.slots);
            this.slots = grown;
        }
        const at = this.length * 3;
        this.slots[at] = kind;
        this.slots[at + 1] = start;
        this.slots[at + 2] = end;
        return this.length++;
    }
    /**
     * The character of an operator token, an empty string for a text run
     */
    operatorAt(index) {
        const at = index * 3;
        return this.slots[at] & TOKEN_OPERATOR ? this.str.charAt(this.slots[at + 1]) : '';
    }
    /**
     * Whether a token is an operator
     */
    isOperator(index) {
        return (this.slots[index * 3] & TOKEN_OPERATOR) !== 0;
    }
    /**
     * Whether the next character continues the run of a token without whitespace in between
     */
    noBreak(index) {
        return (this.slots[index * 3] & TOKEN_NO_BREAK) !== 0;
    }
    /**
     * Value of a token
     */
    value(index) {
        const cleaned = this.cleaned.get(index);
        if (cleaned !== undefined) {
            return cleaned;
        }
        return this.str.slice(this.slots[index * 3 + 1], this.slots[index * 3 + 2]);
    }
}
/**
 * Any whitespace, the test for an angle-addr that needs recovering
 */
const HAS_WHITESPACE = /\s/;
/**
 * An addr-spec that carries its whitespace legally, inside a quoted local part. The
 * optional tail is the malformed shape: a real mailbox with wreckage trailing it.
 */
const QUOTED_LOCAL_ADDR = /^("(?:[^"\\]|\\[\s\S])*"@\S+)(?:\s+([\s\S]+))?$/;
/**
 * One run holding a single '@' and no whitespace, the shape an addr-spec has to have
 */
const ADDR_SPEC = /^[^@\s]+@[^@\s]+$/;
/**
 * The same with a domain literal for the domain, which may hold an '@' of its own
 */
const LITERAL_ADDR_SPEC = /^[^@\s]+@\[[^[\]\\\s]*\]$/;
/**
 * The '@' and domain that follow a quoted local part in the same run
 */
const QUOTED_LOCAL_DOMAIN = /^@(?:[^@\s"]+|\[[^[\]\\\s]*\])$/;
/**
 * Whether a whitespace free run reads as an addr-spec under the strict grammar
 *
 * @param value Run to check
 * @return true when it does
 */
function isAddrSpec(value) {
    return ADDR_SPEC.test(value) || LITERAL_ADDR_SPEC.test(value);
}
/**
 * The looser reading applied once the strict one finds nothing, which tolerates the
 * further '@' that a domain should not have but malformed headers carry anyway
 */
const LOOSE_ADDR_SPEC = /^[^@\s]+@\S+$/;
/**
 * An addr-spec sitting inside free text, together with the whitespace around it. Sticky
 * on purpose: it is only run at the offset looseAddressStart picks, see there.
 */
const LOOSE_TEXT_ADDR = /\s*\b[^@\s]+@[^\s]+\b\s*/y;
/**
 * A domain literal that ends an address. dtext includes '@' (RFC 5322 3.4.1), so the '@'
 * in front of the literal is the one that splits the domain off, not the last one: reading
 * 'a@[x@evil.com]' at its last '@' made it an address at evil.com.
 */
const DOMAIN_LITERAL_TAIL = /@(\[[^[\]\\]*\])$/;
/**
 * Offset of the '@' that splits the domain off an address, or -1 when there is none
 *
 * @param address Address to split
 * @return Offset of the '@'
 */
function domainAt(address) {
    const literal = address.charAt(address.length - 1) === ']' ? DOMAIN_LITERAL_TAIL.exec(address) : null;
    return literal ? address.length - literal[1].length - 1 : address.lastIndexOf('@');
}
/**
 * Restores the quoting of a local part that was read out of a quoted string.
 *
 * RFC 5321 allows '@' inside a quoted local part, so handing '"user@evil.com"@good.com'
 * on as the bare 'user@evil.com@good.com' leaves it to the consumer which '@' splits the
 * domain off. Getting that wrong is a misrouting vector, so the quotes go back on. The
 * same holds for the other specials: a ',' or a ';' that loses its quotes reads as a
 * recipient separator once the consumer puts the address back into a header.
 *
 * @param address Address with an unquoted local part
 * @return Address with the local part as a quoted-string
 */
function quoteLocalPart(address) {
    const lastAt = domainAt(address);
    if (lastAt < 0) {
        // no domain to split off, nothing can be misrouted
        return address;
    }
    const user = address.substring(0, lastAt);
    if (/^[^\s"(),:;<>@[\\\]]+$/.test(user) || /^"(?:[^"\\]|\\[\s\S])*"$/.test(user)) {
        // a local part that carries no special reads the same with or without the quotes,
        // and one that is already a complete quoted-string needs nothing either
        return address;
    }
    return '"' + user.replace(/["\\]/g, '\\$&') + '"@' + address.substring(lastAt + 1);
}
/**
 * The characters JS `\s` matches, which the scan below has to agree with to land on the
 * same match LOOSE_TEXT_ADDR would.
 */
function isSpaceCode(code) {
    return (code === 0x20 ||
        (code >= 0x09 && code <= 0x0d) ||
        code === 0xa0 ||
        code === 0x1680 ||
        (code >= 0x2000 && code <= 0x200a) ||
        code === 0x2028 ||
        code === 0x2029 ||
        code === 0x202f ||
        code === 0x205f ||
        code === 0x3000 ||
        code === 0xfeff);
}
/**
 * The characters JS `\w` matches without the unicode flag, the set the `\b` in
 * LOOSE_TEXT_ADDR is read against. charCodeAt off either end of the string gives NaN,
 * which compares false throughout, so out of range reads as a non-word character.
 */
function isWordCode(code) {
    return ((code >= 0x30 && code <= 0x39) ||
        (code >= 0x41 && code <= 0x5a) ||
        (code >= 0x61 && code <= 0x7a) ||
        code === 0x5f);
}
/**
 * Whether `\b` holds at an offset
 */
function isBoundary(text, at) {
    return isWordCode(text.charCodeAt(at - 1)) !== isWordCode(text.charCodeAt(at));
}
/**
 * Offset of the first '@' in `text` between `from` and `to`, or -1 when the range holds none.
 * Bounded rather than indexOf, which would scan on to the end of the header once for every
 * whitespace delimited run and make the walk below quadratic.
 */
function indexOfAt(text, from, to) {
    for (let i = from; i < to; i++) {
        if (text.charCodeAt(i) === 0x40) {
            return i;
        }
    }
    return -1;
}
/**
 * A quoted-string a value opens with
 */
const LEADING_QUOTED_STRING = /^"(?:[^"\\]|\\[\s\S])*"/;
/**
 * Drops the whitespace on either side of the '@' at an offset.
 *
 * obs-local-part and obs-domain allow CFWS around the '@' (RFC 5322 4.4), so 'user @ good.com'
 * names user@good.com. Kept, the whitespace became part of the address as '"user "@ good.com'.
 * The scan is by index, a pattern such as /\s+@/ backtracks over a long whitespace run that
 * no '@' follows.
 *
 * @param value Value holding the '@'
 * @param at Offset of the '@', or -1
 * @return The value with the whitespace beside that '@' removed
 */
function joinAtSpacing(value, at) {
    if (at < 0) {
        return value;
    }
    let start = at;
    while (start > 0 && isSpaceCode(value.charCodeAt(start - 1))) {
        start--;
    }
    let end = at + 1;
    while (end < value.length && isSpaceCode(value.charCodeAt(end))) {
        end++;
    }
    return start === at && end === at + 1 ? value : value.slice(0, start) + '@' + value.slice(end);
}
/**
 * Drops the whitespace beside the '@' that splits the domain off a value. That is the '@'
 * right after a quoted local part the value opens with, or else the only '@' it holds outside
 * any quoted string. With several it is not clear which one the whitespace belongs to, and
 * '<x@evil.com @good.com>' is left to the addr-spec recovery to read as it always has.
 *
 * @param value Value to clean up
 * @return The value with the whitespace beside that '@' removed
 */
function collapseAtSpacing(value) {
    const quoted = LEADING_QUOTED_STRING.exec(value);
    if (quoted) {
        let at = quoted[0].length;
        while (at < value.length && isSpaceCode(value.charCodeAt(at))) {
            at++;
        }
        if (value.charAt(at) === '@' && value.indexOf('@', at + 1) < 0) {
            return joinAtSpacing(value, at);
        }
    }
    const at = value.indexOf('@');
    if (at < 0 || value.indexOf('@', at + 1) >= 0 || value.lastIndexOf('"') > at) {
        return value;
    }
    return joinAtSpacing(value, at);
}
/**
 * Finds the offset LOOSE_TEXT_ADDR matches at, or -1 when it does not match at all.
 *
 * Letting the pattern search for itself is quadratic: '[^@\s]+' is retried from every
 * offset and rescans the run to the next '@' each time, so a single header well inside
 * the default size limit could hold a core busy for minutes. The search is also
 * unnecessary. '[^@\s]+' crosses neither whitespace nor a '@', so a match can only begin
 * at the head of a whitespace delimited run or just past a '@' inside one, and '[^\s]+\b'
 * gives characters back until it lands on a boundary, so the only end it can take in that
 * run is the last boundary in it. Both are found in one pass, and the pattern is then run
 * at that single offset.
 *
 * @param text Free text to look in
 * @return Offset to match at, or -1
 */
function looseAddressStart(text) {
    const len = text.length;
    let pos = 0;
    while (pos < len) {
        while (pos < len && isSpaceCode(text.charCodeAt(pos))) {
            pos++;
        }
        if (pos >= len) {
            break;
        }
        const runStart = pos;
        let runEnd = pos;
        while (runEnd < len && !isSpaceCode(text.charCodeAt(runEnd))) {
            runEnd++;
        }
        let at = indexOfAt(text, runStart, runEnd);
        if (at >= 0) {
            let lastBoundary = -1;
            for (let k = runEnd; k > runStart; k--) {
                if (isBoundary(text, k)) {
                    lastBoundary = k;
                    break;
                }
            }
            let atomStart = runStart;
            while (lastBoundary >= 0 && at >= 0) {
                // '[^@\s]+' has to cover a character before the '@' and '[^\s]+' one after it,
                // and the boundary that ends the match has to sit past both
                if (at > atomStart && runEnd > at + 1 && lastBoundary > at + 1) {
                    for (let start = atomStart; start < at; start++) {
                        if (isBoundary(text, start)) {
                            if (start > runStart) {
                                return start;
                            }
                            // the leading '\s*' is greedy, so a match that begins at the run
                            // takes the whitespace in front of it along
                            let padded = runStart;
                            while (padded > 0 && isSpaceCode(text.charCodeAt(padded - 1))) {
                                padded--;
                            }
                            return padded;
                        }
                    }
                }
                atomStart = at + 1;
                at = indexOfAt(text, atomStart, runEnd);
            }
        }
        pos = runEnd;
    }
    return -1;
}
/**
 * Recovers the addr-spec from an angle-addr that came back holding unquoted whitespace.
 *
 * A malformed header can put more than a mailbox between the angle brackets, most often
 * because the generator wrote the recipient twice: '<user@example.com user@example.com>'
 * or '<example.com user@example.com>'. Whitespace is not addr-spec, so the whole run can
 * never be a mailbox, and passing it on as the address loses the recipient that is
 * sitting right there in the header.
 *
 * The run that still reads as an addr-spec is kept and whatever is left over becomes
 * display text. Candidates are read strictly first and then under the looser grammar,
 * the same two tiers the unquoted text fallback applies, so that '<a@b@c.com junk>' and a
 * bare 'a@b@c.com junk' agree on the recipient.
 *
 * A quoted local part is left alone: RFC 5321 allows whitespace inside it, so
 * '<"user name"@example.com>' is well formed and means exactly what it says.
 *
 * @param address Collected address
 * @param text Collected display text
 * @return The address and the display text, with any leftovers moved to the text
 */
function recoverAddrSpec(address, text) {
    address = collapseAtSpacing(address);
    if (!HAS_WHITESPACE.test(address)) {
        return { address, text };
    }
    let rest;
    const quoted = address.match(QUOTED_LOCAL_ADDR);
    if (quoted) {
        if (!quoted[2]) {
            // the whitespace sits inside the quoted local part, this is a well formed mailbox
            return { address, text };
        }
        // a real mailbox with wreckage trailing it, so peel the addr-spec off whole rather
        // than splitting into the quotes
        address = quoted[1];
        rest = [quoted[2]];
    }
    else {
        if (address.indexOf('"') >= 0) {
            // Splitting on whitespace loses track of where a quoted string starts and ends,
            // and addresses are never taken out of quoted strings: the run picked out of
            // '<junk "user@evil.com b"@good.com>' would be an address from the domain the
            // quotes were hiding. Every well formed shape was handled above, so the original
            // is the honest answer
            return { address, text };
        }
        const parts = address.split(/\s+/);
        let addrIndex = parts.findIndex(isAddrSpec);
        if (addrIndex < 0) {
            addrIndex = parts.findIndex(part => LOOSE_ADDR_SPEC.test(part));
        }
        if (addrIndex < 0) {
            // nothing in there reads as an address, there is no better answer than the original
            return { address, text };
        }
        address = parts.splice(addrIndex, 1)[0];
        rest = parts;
    }
    return {
        address,
        text: [text, ...rest].filter(part => part).join(' ')
    };
}
/**
 * Takes the RFC 5322 comments out of the contents of an angle-addr.
 *
 * The tokenizer tracks a single open operator, so once '<' is open a '(' is plain text and
 * a comment inside the brackets reached the address verbatim: 'Name <user@example.com(x)evil.com>'
 * put 'user@example.com(x)evil.com' into the address, a value that is no mailbox and that a
 * consumer stripping the comment reads as 'user@example.comevil.com'. A comment is folding
 * whitespace, so it is read as a space that splits two atoms and as nothing next to an '@',
 * the same rule the token walk applies outside the brackets. Quoted strings and domain
 * literals are copied through untouched, a '(' in there is not a comment. An unexpected '<'
 * outside them drops everything in front of it, comments included.
 *
 * RFC 822 also let an angle-addr name the relays to go through in front of the mailbox,
 * '<@relay1,@relay2:user@example.com>', which RFC 5322 still parses as obs-route. The route
 * is not part of the mailbox, and folded into the local part it made
 * '"@relay1,@relay2:user"@example.com' a recipient that does not exist. A local part can not
 * start with '@', so contents that do, up to the first ':' outside a domain literal and in
 * front of any quoted string, are a route and are dropped, as long as a mailbox with an '@'
 * of its own follows.
 *
 * @param address Contents of the angle brackets
 * @return The address with the comments removed, and the text of the comments
 */
function stripAddressComments(address) {
    const comments = [];
    let result = '';
    let comment = '';
    let depth = 0;
    let closer = '';
    // carried along rather than read back off the growing result, which would flatten it on
    // every comment (see lastChars in _handleAddress)
    let lastChar = '';
    // A comment that just closed stands for a space, written once the next character shows
    // whether one is wanted: not beside an '@', and not on top of whitespace that follows.
    // Deciding on the spot saw only the character right after the ')', so a second comment
    // in a row hid the '@' behind it and 'a(x)(y)@b' read as 'a @b'
    let pendingSpace = false;
    // first character of the result and whether a quoted string has opened since, which
    // together tell a route from a local part
    let firstChar = '';
    let quoteSeen = false;
    let routeEnd = -1;
    for (let i = 0, len = address.length; i < len; i++) {
        const chr = address.charAt(i);
        if (depth) {
            if (chr === '\\' && i < len - 1) {
                comment += address.charAt(++i);
            }
            else if (chr === '(') {
                depth++;
                comment += chr;
            }
            else if (chr === ')' && !--depth) {
                comments.push(comment.trim());
                comment = '';
                pendingSpace = lastChar !== '@';
            }
            else {
                comment += chr;
            }
            continue;
        }
        if (pendingSpace && chr !== '(') {
            pendingSpace = false;
            if (chr !== '@' && chr !== '<' && !isSpaceCode(address.charCodeAt(i))) {
                result += ' ';
                lastChar = ' ';
            }
        }
        if (closer) {
            if (chr === '\\' && closer === '"' && i < len - 1) {
                result += chr + address.charAt(++i);
                lastChar = address.charAt(i);
                continue;
            }
            if (chr === closer) {
                closer = '';
            }
        }
        else if (chr === '"') {
            closer = '"';
            quoteSeen = true;
        }
        else if (chr === ':' && routeEnd < 0 && firstChar === '@' && !quoteSeen) {
            routeEnd = result.length + 1;
        }
        else if (chr === '[') {
            closer = ']';
        }
        else if (chr === '(') {
            depth = 1;
            continue;
        }
        else if (chr === '<') {
            // Apple Mail drops everything between an unexpected '<' and the address after it.
            // Read here rather than off the raw brackets so that a '<' inside a quoted string,
            // a comment or a domain literal stays where it is: '<"a<b"@victim.com>' cut at
            // the first '<' left the address 'b"@victim.com'
            result = '';
            lastChar = '';
            comments.length = 0;
            firstChar = '';
            quoteSeen = false;
            routeEnd = -1;
            continue;
        }
        result += chr;
        lastChar = chr;
        if (!firstChar && !isSpaceCode(address.charCodeAt(i))) {
            firstChar = chr;
        }
    }
    if (routeEnd >= 0 && result.indexOf('@', routeEnd) >= 0) {
        result = result.slice(routeEnd);
    }
    if (depth) {
        // an unterminated comment runs to the end of the address
        comments.push(comment.trim());
    }
    return { address: result.trim(), comments: comments.filter(text => text) };
}
/**
 * Walks the tokens of one entry of an address list and sorts them into the runs of display
 * text, angle-addr and comment they belong to
 *
 * @param tokens Tokens of the whole address list
 * @param from Index of the first token of the entry
 * @param to Index just past the last token of the entry
 * @return The collected runs, and whether the display text came out of a comment
 */
function collectAddressParts(tokens, from, to) {
    let state = 'text';
    let data = {
        address: [],
        comment: [],
        text: [],
        textWasQuoted: [], // Track which text tokens came from inside quotes
        // For a text run that is a quoted local part followed by the unquoted '@' and domain
        // of an addr-spec, '"user"@example.com', the length of the local part, -1 otherwise
        quotedLocalAt: []
    };
    // whether the last text run holds nothing but quoted text so far, which is what a quoted
    // local part is until the '@' after it joins the run
    let lastTextPureQuoted = false;
    let i;
    let insideQuotes = false; // Track if we're currently inside a quoted string
    // Last character of the run each state is currently accumulating. Reading it back off
    // the accumulator with slice(-1) makes the engine flatten the whole growing string on
    // every token, which is quadratic over an address built from many comment-joined atoms.
    // A run only ever grows by the token appended below, so the character is carried along.
    const lastChars = { address: '', comment: '', text: '' };
    // Filter out <addresses>, (comments) and regular text
    for (i = from; i < to; i++) {
        const value = tokens.value(i);
        // the operator in front of this token, if there is one, and whether it runs on into it
        const prevOperator = i > from ? tokens.operatorAt(i - 1) : '';
        const prevNoBreak = i > from && tokens.noBreak(i - 1);
        if (tokens.isOperator(i)) {
            switch (value) {
                case '<':
                    state = 'address';
                    insideQuotes = false;
                    break;
                case '(':
                    state = 'comment';
                    insideQuotes = false;
                    break;
                case '"':
                    // Track quote state for text tokens
                    insideQuotes = !insideQuotes;
                    state = 'text';
                    break;
                default:
                    state = 'text';
                    insideQuotes = false;
                    break;
            }
        }
        else {
            // An empty quoted string is dropped by the tokenizer, leaving no text token of its
            // own to record the quoting on, so the pair of quote operators right in front of
            // this token is all that is left of it and the run it opens carries the quoting
            // instead. Without this '""@example.com' reads as the bare '@example.com'. It only
            // ever opens a run: a run already holding unquoted text is not a quoted string
            const opensAfterEmptyQuotedString = prevOperator === '"' && prevNoBreak && i > from + 1 && tokens.operatorAt(i - 2) === '"';
            // A comment is folding whitespace. It may sit inside an addr-spec, on either side
            // of the '@', but it cannot join two atoms into one: gluing across it would read
            // 'user@example.com(x)evil.com' as the single domain 'example.comevil.com' and
            // name a domain the sender never wrote.
            const joins = prevNoBreak &&
                data[state].length &&
                (prevOperator !== ')' || lastChars[state] === '@' || value.charAt(0) === '@');
            if (joins) {
                // join values
                const last = data[state].length - 1;
                if (state === 'text' && !insideQuotes) {
                    if (lastTextPureQuoted && value.charAt(0) === '@') {
                        data.quotedLocalAt[last] = data.text[last].length;
                    }
                    lastTextPureQuoted = false;
                }
                data[state][last] += value;
                if (state === 'text' && insideQuotes) {
                    data.textWasQuoted[last] = true;
                }
            }
            else {
                data[state].push(value);
                if (state === 'text') {
                    data.textWasQuoted.push(insideQuotes || opensAfterEmptyQuotedString);
                    // an empty quoted string leaves no text of its own, so the '@' opens the run
                    data.quotedLocalAt.push(opensAfterEmptyQuotedString && value.charAt(0) === '@' ? 0 : -1);
                    lastTextPureQuoted = insideQuotes;
                }
            }
            lastChars[state] = value.charAt(value.length - 1);
        }
    }
    // If there is no text but a comment, replace the two. A comment is never part of a
    // mailbox, so text that came out of one only ever names it: reading an address out of it
    // made '(a@evil.com)' a recipient where no conformant reading has a mailbox at all
    let textFromComment = false;
    if (!data.text.length && data.comment.length) {
        data.text = data.comment;
        data.comment = [];
        textFromComment = true;
    }
    return { data, textFromComment };
}
/**
 * Name of a group, from the tokens in front of its ':'. A comment names it when no text
 * does, as it names a mailbox.
 *
 * @param tokens Tokens of the whole address list
 * @param from Index of the first token in front of the ':'
 * @param to Index of the ':'
 * @return Decoded name of the group
 */
function groupName(tokens, from, to) {
    // http://tools.ietf.org/html/rfc2822#appendix-A.1.3
    return (0, decode_strings_js_1.decodeWords)(collectAddressParts(tokens, from, to).data.text.join(' '));
}
/**
 * Converts tokens for a single address into an address object
 *
 * @param tokens Tokens of the whole address list
 * @param from Index of the first token of this address
 * @param to Index just past the last token of this address
 * @return The address object
 */
function _handleAddress(tokens, from, to) {
    const collected = collectAddressParts(tokens, from, to);
    const data = collected.data;
    let textFromComment = collected.textFromComment;
    let i;
    // Comments come out of the angle-addr before anything asks whether one was found, so
    // that brackets holding nothing but a comment read the same as empty ones
    const addressComments = [];
    const addressParts = [];
    for (const part of data.address) {
        const stripped = stripAddressComments(part);
        for (const comment of stripped.comments) {
            addressComments.push(comment);
        }
        if (stripped.address) {
            addressParts.push(stripped.address);
        }
    }
    data.address = addressParts;
    // If no address was found, try to detect one from regular text
    if (!data.address.length && data.text.length && !textFromComment) {
        // Whitespace beside the '@' is CFWS, so 'user @ good.com' is read as one run. Both
        // tiers read the collapsed runs, and only a run an address comes out of is replaced
        // by its collapsed form, the display text keeps its spacing
        const candidates = data.text.map(part => collapseAtSpacing(part));
        // The first addr-spec in the text is the mailbox, as it is for a conformant parser
        // reading as far as it can. Taking the last one let a comment part two of them and
        // pick the second, 'user@good.com (x) evil@evil.com' named evil.com, while the
        // same two without the comment, one run, named good.com
        for (i = 0; i < data.text.length; i++) {
            // Security fix: Do not extract email addresses from quoted strings
            // RFC 5321 allows @ inside quoted local-parts like "user@domain"@example.com
            // Extracting emails from quoted text leads to misrouting vulnerabilities
            // A run that is a quoted local part with its '@' and domain is an addr-spec of
            // its own, with the quoting put back on, and takes its turn like any other
            const local = data.quotedLocalAt[i];
            const quotedLocal = data.textWasQuoted[i] && local >= 0 && QUOTED_LOCAL_DOMAIN.test(data.text[i].slice(local))
                ? quoteLocalPart(data.text[i])
                : '';
            if (quotedLocal || (!data.textWasQuoted[i] && isAddrSpec(candidates[i]))) {
                data.address = [quotedLocal || candidates[i]];
                data.text.splice(i, 1);
                data.textWasQuoted.splice(i, 1);
                data.quotedLocalAt.splice(i, 1);
                break;
            }
        }
        // still no address
        if (!data.address.length) {
            for (i = 0; i < data.text.length; i++) {
                // Security fix: Do not extract email addresses from quoted strings
                if (!data.textWasQuoted[i]) {
                    // handles an email address that has more than one @. The strict tier
                    // found nothing, so it spliced nothing and the indexes still line up
                    const part = candidates[i];
                    const start = looseAddressStart(part);
                    if (start >= 0) {
                        LOOSE_TEXT_ADDR.lastIndex = start;
                        const match = LOOSE_TEXT_ADDR.exec(part);
                        if (match) {
                            data.address = [match[0].trim()];
                            // the match takes the whitespace around the address along, so
                            // the text on either side is joined with a single space
                            data.text[i] = (part.slice(0, start) + ' ' + part.slice(start + match[0].length)).trim();
                            break;
                        }
                    }
                    data.text[i] = data.text[i].trim();
                }
            }
        }
    }
    // If there's still no text but a comment exists, replace the two
    if (!data.text.length && data.comment.length) {
        data.text = data.comment;
        data.comment = [];
    }
    // Keep only the first address occurrence, push others to regular text
    if (data.address.length > 1) {
        data.text = data.text.concat(data.address.splice(1));
    }
    // An address is only taken from unquoted text, so anything left in the text at this
    // point that still has to serve as the address carries its quoting in this flag
    const addressFromQuotedText = !data.address.length && data.textWasQuoted.some(wasQuoted => wasQuoted);
    // Join values with spaces
    let text = data.text.join(' ');
    let addressValue = data.address.join(' ');
    // A field that is nothing but encoded words names the mailbox and is not one. The
    // decoded text used to be parsed again when it held an angle-addr, so a word decoding
    // to `CEO <ceo@victim.example>` became that mailbox. Nothing that authenticates the
    // message reads it that way: a DMARC verifier takes the author from the raw header,
    // where the word holds no mailbox, so the message has no author domain to check and
    // the sender it showed here was one no verifier had seen. nodemailer, mailparser and
    // Python read the field as a name as well.
    //
    // `^=\?[^=]+?=$` could not match a base64 word whose padding puts an '=' inside it,
    // so whether a bare encoded word was decoded or left to become the address itself
    // came down to whether its payload happened to need padding.
    if (!addressValue && (0, decode_strings_js_1.isEncodedWordsOnly)(text.trim())) {
        return { address: '', name: (0, decode_strings_js_1.decodeWords)(text) };
    }
    if (addressFromQuotedText && text.indexOf('@') >= 0) {
        // The mailbox is still sitting in the text, so it moves over here and is quoted
        // before the recovery below rather than after it. Anything else the text holds
        // came along with it: a comment ends the domain but leaves the atoms behind it in
        // the same text, so '"user"@example.com(x)evil.com' would otherwise hand on
        // 'user@example.com evil.com', a second domain riding along in a value that is no
        // addr-spec at all. Putting the quotes back first is what lets the recovery tell
        // the whitespace a quoted local part may carry from the wreckage trailing one
        // The quotes are gone at this point, so the '@' the domain splits off at is the
        // last one, not the single one collapseAtSpacing insists on
        addressValue = quoteLocalPart(joinAtSpacing(text, domainAt(text)));
        text = '';
    }
    ({ address: addressValue, text } = recoverAddrSpec(addressValue, text));
    // a comment names the mailbox only when nothing else does, as one outside the brackets
    if (!text && addressComments.length) {
        text = addressComments.join(' ');
        textFromComment = true;
    }
    const rawName = text || addressValue || '';
    const address = {
        address: addressValue || (textFromComment ? '' : text) || '',
        name: (0, decode_strings_js_1.decodeWords)(rawName)
    };
    // The raw comparison is the check Nodemailer makes, it holds when a single source
    // filled both fields. The decoded one is added because postal-mime decodes names,
    // which also catches a name that decodes to the address itself. Comparing only the
    // decoded name kept a name that mixes an encoded word with plain text as the address
    if (address.address === rawName || address.address === address.name) {
        if (address.address.match(/@/)) {
            address.name = '';
        }
        else {
            address.address = '';
        }
    }
    return address;
}
/**
 * Tokenizer for address field strings
 */
class Tokenizer {
    /**
     * @param str Address field string
     */
    constructor(str) {
        this.str = (str || '').toString();
        this.operatorCurrent = '';
        this.operatorExpecting = '';
        this.node = -1;
        this.escaped = false;
        this.inDomainLiteral = false;
        this.afterAt = false;
        this.inGroup = false;
        this.innerQuoted = false;
        this.innerComment = 0;
        this.innerLiteral = false;
        this.innerEscaped = false;
        this.list = new TokenList(this.str);
        this.operators = {
            '"': '"',
            '(': ')',
            '<': '>',
            ',': '',
            // A group is read in the same pass as the rest of the list, so its ':' only marks
            // where the name ends and its members are tokenized like any other address
            ':': '',
            // Semicolons are not a legal delimiter per the RFC2822 grammar other
            // than for terminating a group, but they are also not valid for any
            // other use in this context.  Given that some mail clients have
            // historically allowed the semicolon as a delimiter equivalent to the
            // comma in their UI, it makes sense to treat them the same as a comma
            // when used outside of a group.
            ';': ''
        };
    }
    /**
     * Tokenizes the original input string
     *
     * @return An array of operator|text tokens
     */
    tokenize() {
        const str = this.str;
        const len = str.length;
        for (let i = 0; i < len; i++) {
            this.checkChar(str.charAt(i), i);
        }
        this.closeText(len);
        // Compacted in place: a text run is trimmed to its value and one left empty is
        // dropped, and the value of a run that is no plain slice is rebuilt and kept aside
        const list = this.list;
        const slots = list.slots;
        let kept = 0;
        for (let i = 0, count = list.length; i < count; i++) {
            const kind = slots[i * 3];
            let start = slots[i * 3 + 1];
            let end = slots[i * 3 + 2];
            if (kind & TOKEN_DIRTY) {
                const value = this.cleanValue(start, end, kind).trim();
                if (!value) {
                    continue;
                }
                list.cleaned.set(kept, value);
            }
            else if (!(kind & TOKEN_OPERATOR)) {
                while (start < end && isSpaceCode(str.charCodeAt(start))) {
                    start++;
                }
                while (end > start && isSpaceCode(str.charCodeAt(end - 1))) {
                    end--;
                }
                if (start === end) {
                    continue;
                }
            }
            slots[kept * 3] = kind;
            slots[kept * 3 + 1] = start;
            slots[kept * 3 + 2] = end;
            kept++;
        }
        list.length = kept;
        return list;
    }
    /**
     * Ends the text run being collected, if there is one
     *
     * @param end Offset just past its last character
     */
    closeText(end) {
        if (this.node >= 0) {
            this.list.slots[this.node * 3 + 2] = end;
            this.node = -1;
        }
    }
    /**
     * Rebuilds the value of a text run that is no plain slice of the field, applying the
     * rules checkChar collects characters by: an escaping backslash is dropped, a line break
     * reads as a space and any other control character is left out
     *
     * @param start Offset of the first character of the run
     * @param end Offset just past its last character
     * @param kind Kind and flags of the run
     * @return Value of the run
     */
    cleanValue(start, end, kind) {
        const str = this.str;
        const escapes = (kind & TOKEN_ESCAPES) !== 0;
        let escaped = (kind & TOKEN_STARTS_ESCAPED) !== 0;
        let value = '';
        for (let i = start; i < end; i++) {
            const chr = str.charAt(i);
            if (escapes && !escaped && chr === '\\') {
                escaped = true;
                continue;
            }
            escaped = false;
            if (chr === '\n') {
                value += ' ';
            }
            else if (chr.charCodeAt(0) >= 0x21 || chr === ' ' || chr === '\t') {
                value += chr;
            }
        }
        return value;
    }
    /**
     * Checks if a character is an operator or text and acts accordingly
     *
     * @param chr Character from the address field
     * @param i Offset of the character in the field
     */
    checkChar(chr, i) {
        // Track RFC 5322 domain-literals ("[" *dtext "]"). The ":" of an IPv6 address-literal
        // (user@[IPv6:2001:db8::1]) is dtext and must not be read as the group delimiter while
        // inside the brackets. That is the only operator the literal hides: letting it hide
        // the others as well meant a "[" could turn the comment, quoted string or angle-addr
        // after it into text and pick a different mailbox, '[ ( ] <a@victim.com> ) <b@evil.com>'
        // yielded a@victim.com where RFC 5322 reads b@evil.com. A "[" also only opens a literal
        // right after the "@" of an addr-spec, so the group delimiter of a display name
        // holding one stays intact. Quoted strings and comments are handled via
        // operatorExpecting, so this state is only entered when no operator is open. The list
        // separators "," and ";" always end the literal, so that an unclosed "[" can not
        // swallow later recipients.
        if (!this.escaped && !this.operatorExpecting) {
            if (!this.inDomainLiteral && chr === '[' && this.afterAt) {
                this.inDomainLiteral = true;
            }
            else if (this.inDomainLiteral && (chr === ']' || chr === ',' || chr === ';')) {
                this.inDomainLiteral = false;
            }
        }
        // The closer of an angle-addr is only read outside the quoted strings, comments and
        // domain literals it holds. Looking for nothing but the closer let a '>' inside a
        // quoted local part end the angle-addr, '<"a@evil.com>"@good.com>' was read as an
        // address at evil.com. The characters are still collected as they are, the angle-addr
        // is read again later
        let nested = false;
        if (this.operatorExpecting === '>') {
            nested = this.trackInner(chr);
            if (!nested && chr === ';' && this.inGroup) {
                // The ';' of a group ends an angle-addr left open inside it, as it always did
                // when a group was cut out of the field at its ';' and parsed on its own. Read
                // as text instead, an unclosed '<' swallowed the end of the group and every
                // recipient after it
                this.closeText(i);
                this.operatorExpecting = '';
                this.resetInner();
            }
        }
        else if (this.operatorExpecting === ')' && !this.escaped) {
            // Comments nest (RFC 5322 3.2.2). Ending one at the first ')' let the ')' of a
            // nested comment close the outer one and released the rest of it, an address
            // included, into the header
            if (chr === '(') {
                this.innerComment++;
            }
            else if (chr === ')' && this.innerComment) {
                this.innerComment--;
                nested = true;
            }
        }
        if (this.escaped) {
            // ignore next condition blocks
        }
        else if (chr === this.operatorExpecting && !nested) {
            const nextChr = this.str.charAt(i + 1);
            this.closeText(i);
            this.list.push(nextChr && ![' ', '\t', '\r', '\n', ',', ';'].includes(nextChr)
                ? TOKEN_OPERATOR | TOKEN_NO_BREAK
                : TOKEN_OPERATOR, i, i + 1);
            if (chr !== ')') {
                // a comment is folding whitespace, it does not part the "@" from the "["
                this.afterAt = false;
            }
            this.operatorExpecting = '';
            this.escaped = false;
            this.resetInner();
            return;
        }
        else if (!this.operatorExpecting && !(this.inDomainLiteral && chr === ':') && chr in this.operators) {
            this.closeText(i);
            this.list.push(TOKEN_OPERATOR, i, i + 1);
            if (chr === ':') {
                this.inGroup = true;
            }
            else if (chr === ';') {
                this.inGroup = false;
            }
            if (chr !== '(') {
                this.afterAt = false;
            }
            this.operatorExpecting = this.operators[chr];
            this.escaped = false;
            this.resetInner();
            return;
        }
        else if ((this.operatorExpecting === '"' || this.operatorExpecting === ')') && chr === '\\') {
            // A backslash escapes the next character inside a quoted string and inside a
            // comment alike (RFC 5322 3.2.2, ccontent includes quoted-pair). Honouring it
            // only in quoted strings let an escaped parenthesis close the comment, which
            // released the rest of it, an address included, into the header
            this.escaped = true;
            if (this.node >= 0) {
                // the backslash is left out of the value
                this.list.slots[this.node * 3] |= TOKEN_DIRTY;
            }
            return;
        }
        if (this.node < 0) {
            this.node = this.list.push((this.operatorExpecting === '"' || this.operatorExpecting === ')' ? TOKEN_ESCAPES : 0) |
                (this.escaped ? TOKEN_STARTS_ESCAPED : 0), i, i);
        }
        if (chr === '\n') {
            // Convert newlines to spaces. Carriage return is ignored as \r and \n usually
            // go together anyway and there already is a WS for \n. Lone \r means something is fishy.
            chr = ' ';
            this.list.slots[this.node * 3] |= TOKEN_DIRTY;
        }
        if (chr.charCodeAt(0) >= 0x21 || chr === ' ' || chr === '\t') {
            // the character is part of the value, which is read off the field later
            // text inside a quoted string or a comment is not part of an addr-spec. Tracked
            // as it goes rather than read back off the value (see lastChars in _handleAddress)
            if (!this.operatorExpecting && chr !== ' ' && chr !== '\t') {
                this.afterAt = chr === '@';
            }
        }
        else {
            // skip command bytes
            this.list.slots[this.node * 3] |= TOKEN_DIRTY;
        }
        this.escaped = false;
    }
    /**
     * Tracks the quoted strings, comments and domain literals inside an angle-addr, which its
     * closer must not be read from. A backslash escapes the next character inside a quoted
     * string and a comment. A domain literal opens right after an "@" and ends at the "]".
     * dtext holds the list separators as well, and inside the brackets they never split the
     * list anyway.
     *
     * @param chr Character from the address field
     * @return true while the character sits inside one of them, the one that closes it included
     */
    trackInner(chr) {
        if (this.innerEscaped) {
            this.innerEscaped = false;
            return true;
        }
        if (this.innerQuoted) {
            if (chr === '\\') {
                this.innerEscaped = true;
            }
            else if (chr === '"') {
                this.innerQuoted = false;
            }
            return true;
        }
        if (this.innerComment) {
            if (chr === '\\') {
                this.innerEscaped = true;
            }
            else if (chr === '(') {
                this.innerComment++;
            }
            else if (chr === ')') {
                this.innerComment--;
            }
            return true;
        }
        if (this.innerLiteral) {
            if (chr === ']') {
                this.innerLiteral = false;
            }
            return true;
        }
        if (chr === '"') {
            this.innerQuoted = true;
            return true;
        }
        if (chr === '(') {
            this.innerComment = 1;
            return true;
        }
        if (chr === '[' && this.afterAt) {
            this.innerLiteral = true;
            return true;
        }
        // afterAt is otherwise only kept outside the operators and is cleared when one opens
        // or ends, so inside an angle-addr it serves the literal tracked here
        if (!isSpaceCode(chr.charCodeAt(0))) {
            this.afterAt = chr === '@';
        }
        return false;
    }
    /**
     * Forgets the nesting collected for the operator that just opened or ended
     */
    resetInner() {
        this.innerQuoted = false;
        this.innerComment = 0;
        this.innerLiteral = false;
        this.innerEscaped = false;
    }
}
/**
 * Folds the fragments an unquoted display name holding a comma is split into back together.
 *
 * "Joe Foo, PhD <joe@example.com>" is split on the comma into
 * [{name:"Joe Foo", address:""}, {name:"PhD", address:"joe@example.com"}]. A name-only entry
 * followed by an entry with both name and address is recombined. Walked back to front so
 * that a run of fragments folds into one entry in a single pass. Splicing each fragment out
 * of the list instead would be quadratic.
 *
 * @param list Parsed entries, in order
 * @return The entries with the fragments folded in
 */
function mergeNameFragments(list) {
    const merged = [];
    for (let i = list.length - 1; i >= 0; i--) {
        const current = list[i];
        const next = merged.length ? merged[merged.length - 1] : null;
        if (next && current.address === '' && current.name && !current.group && next.address && next.name) {
            next.name = current.name + ', ' + next.name;
        }
        else {
            merged.push(current);
        }
    }
    return merged.reverse();
}
/**
 * Parses an address list, groups included, in a single pass over its tokens.
 *
 * A group used to be cut out of the field at the ';' that ends it and parsed again as an
 * address list of its own, recursively, so every level of nesting parsed what was left of
 * the field once more. RFC 5322 does not nest groups at all, and the nested ones were
 * flattened anyway. The tokens are now walked once: a ':' opens a group, its members are
 * read as they come, a ';' closes it. A ':' inside an open group stands for a group nested
 * in it, whose name is dropped and whose members belong to the outer one, and the first ';'
 * ends the group, nested or not, as before.
 *
 * @param str Address field
 * @return An array of address objects
 */
function parseAddressList(str) {
    const tokens = new Tokenizer(str).tokenize();
    const parsedAddresses = [];
    let group = null;
    let members = [];
    // Every address is handed over as the range of the token list it covers, as soon as the
    // separator after it is seen. Copying the tokens of each address into an array of its own,
    // and collecting those before handling any, held a second structure as large as the token
    // list for the whole parse, and an array that receives a single push is allocated room for
    // seventeen: a list of one letter names took some 80 times its size in that alone
    let from = 0;
    for (let i = 0, len = tokens.length; i <= len; i++) {
        const operator = i < len ? tokens.operatorAt(i) : '';
        if (i < len && operator !== ',' && operator !== ';' && operator !== ':') {
            continue;
        }
        if (operator === ':') {
            if (!group) {
                group = { name: groupName(tokens, from, i), group: [] };
                members = [];
            }
            from = i + 1;
            continue;
        }
        if (i > from) {
            // Appended in place. Rebuilding the list with concat() for every address copies
            // everything parsed so far and is quadratic in the number of addresses.
            (group ? members : parsedAddresses).push(_handleAddress(tokens, from, i));
        }
        from = i + 1;
        if (group && (operator === ';' || i === len)) {
            group.group = mergeNameFragments(members);
            parsedAddresses.push(group);
            group = null;
        }
    }
    return mergeNameFragments(parsedAddresses);
}
/**
 * Parses structured e-mail addresses from an address field
 *
 * Example:
 *
 *    'Name <address@domain>'
 *
 * will be converted to
 *
 *     [{name: 'Name', address: 'address@domain'}]
 *
 * @param str Address field
 * @param options Optional options object
 * @return An array of address objects
 */
function addressParser(str, options) {
    const parsedAddresses = parseAddressList(str);
    if (options && options.flatten) {
        let addresses = [];
        let walkAddressList = (list) => {
            list.forEach(address => {
                if (address.group) {
                    return walkAddressList(address.group);
                }
                else {
                    addresses.push(address);
                }
            });
        };
        walkAddressList(parsedAddresses);
        return addresses;
    }
    return parsedAddresses;
}
// expose to the world
exports.default = addressParser;
Object.defineProperty(exports.default, 'default', { value: exports.default, enumerable: false, writable: true, configurable: true });
module.exports = exports.default;
//# sourceMappingURL=address-parser.js.map
},
"./base64-decoder.js":function(module,exports,require){
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const decode_strings_js_1 = require("./decode-strings.js");
const chunk_writer_js_1 = __importDefault(require("./chunk-writer.js"));
class Base64Decoder {
    constructor(opts) {
        opts = opts || {};
        this.decoder = opts.decoder || new TextDecoder();
        this.maxChunkSize = 100 * 1024;
        this.output = new chunk_writer_js_1.default();
        this.remainder = '';
    }
    pushChunk(base64Str) {
        if (base64Str.length) {
            this.output.append(new Uint8Array((0, decode_strings_js_1.decodeBase64)(base64Str)));
        }
    }
    flushRemainder() {
        this.pushChunk(this.remainder);
        this.remainder = '';
    }
    update(buffer) {
        let str = this.decoder.decode(buffer).replace(/[^a-zA-Z0-9+/=]+/g, '');
        // '=' terminates a base64 unit. Some mailers pad every line, and erasing the
        // padding used to concatenate the units, which knocked everything after the first
        // embedded pad out of 4 character alignment and decoded it to garbage.
        //
        // Each unit is flushed as soon as its '=' is found. A run of '=' flushes an empty
        // remainder, which writes nothing.
        let start = 0;
        let end;
        while ((end = str.indexOf('=', start)) >= 0) {
            this.remainder += str.substring(start, end);
            this.flushRemainder();
            start = end + 1;
        }
        // the trailing piece is not followed by padding, so it stays open
        this.remainder += str.substring(start);
        if (this.remainder.length >= this.maxChunkSize) {
            const alignedLength = Math.floor(this.remainder.length / 4) * 4;
            this.pushChunk(this.remainder.substring(0, alignedLength));
            this.remainder = this.remainder.substring(alignedLength);
        }
    }
    finalize() {
        this.flushRemainder();
        return this.output.finalize();
    }
}
exports.default = Base64Decoder;
Object.defineProperty(exports.default, 'default', { value: exports.default, enumerable: false, writable: true, configurable: true });
module.exports = exports.default;
//# sourceMappingURL=base64-decoder.js.map
},
"./base64-encoder.js":function(module,exports,require){
"use strict";
// Code from: https://gist.githubusercontent.com/jonleighton/958841/raw/fb05a8632efb75d85d43deb593df04367ce48371/base64ArrayBuffer.js
Object.defineProperty(exports, "__esModule", { value: true });
exports.base64ArrayBuffer = base64ArrayBuffer;
// Converts an ArrayBuffer directly to base64, without any intermediate 'convert to string then
// use window.btoa' step. According to my tests, this appears to be a faster approach:
// http://jsperf.com/encoding-xhr-image-data/5
/*
MIT LICENSE

Copyright 2011 Jon Leighton

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/
function base64ArrayBuffer(arrayBuffer) {
    let base64 = '';
    const encodings = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const bytes = new Uint8Array(arrayBuffer);
    const byteLength = bytes.byteLength;
    const byteRemainder = byteLength % 3;
    const mainLength = byteLength - byteRemainder;
    let a, b, c, d;
    let chunk;
    // Main loop deals with bytes in chunks of 3
    for (let i = 0; i < mainLength; i = i + 3) {
        // Combine the three bytes into a single integer
        chunk = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
        // Use bitmasks to extract 6-bit segments from the triplet
        a = (chunk & 16515072) >> 18; // 16515072 = (2^6 - 1) << 18
        b = (chunk & 258048) >> 12; // 258048   = (2^6 - 1) << 12
        c = (chunk & 4032) >> 6; // 4032     = (2^6 - 1) << 6
        d = chunk & 63; // 63       = 2^6 - 1
        // Convert the raw binary segments to the appropriate ASCII encoding
        base64 += encodings[a] + encodings[b] + encodings[c] + encodings[d];
    }
    // Deal with the remaining bytes and padding
    if (byteRemainder === 1) {
        chunk = bytes[mainLength];
        a = (chunk & 252) >> 2; // 252 = (2^6 - 1) << 2
        // Set the 4 least significant bits to zero
        b = (chunk & 3) << 4; // 3   = 2^2 - 1
        base64 += encodings[a] + encodings[b] + '==';
    }
    else if (byteRemainder === 2) {
        chunk = (bytes[mainLength] << 8) | bytes[mainLength + 1];
        a = (chunk & 64512) >> 10; // 64512 = (2^6 - 1) << 10
        b = (chunk & 1008) >> 4; // 1008  = (2^6 - 1) << 4
        // Set the 2 least significant bits to zero
        c = (chunk & 15) << 2; // 15    = 2^4 - 1
        base64 += encodings[a] + encodings[b] + encodings[c] + '=';
    }
    return base64;
}
//# sourceMappingURL=base64-encoder.js.map
},
"./chunk-writer.js":function(module,exports,require){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const decode_strings_js_1 = require("./decode-strings.js");
/**
 * Collects decoded content in fixed size chunks, so memory follows the number of bytes
 * written rather than the number of writes. Decoders that write many short runs, such as
 * a quoted-printable line or a base64 body that pads every line, would otherwise hold a
 * buffer per run.
 */
class ChunkWriter {
    constructor(maxChunkSize = 100 * 1024) {
        this.maxChunkSize = maxChunkSize;
        // allocated on the first write, a part with no content costs nothing
        this.buffer = null;
        this.bufferPos = 0;
        this.chunks = [];
    }
    writeByte(byte) {
        if (!this.buffer || this.bufferPos >= this.buffer.length) {
            this.flush();
            this.buffer ??= new Uint8Array(this.maxChunkSize);
        }
        this.buffer[this.bufferPos++] = byte;
    }
    // Copied in runs rather than a byte at a time
    writeBytes(bytes, start = 0, end = bytes.length) {
        while (start < end) {
            if (!this.buffer || this.bufferPos >= this.buffer.length) {
                this.flush();
                this.buffer ??= new Uint8Array(this.maxChunkSize);
            }
            const count = Math.min(end - start, this.buffer.length - this.bufferPos);
            this.buffer.set(bytes.subarray(start, start + count), this.bufferPos);
            this.bufferPos += count;
            start += count;
        }
    }
    /**
     * Keeps a buffer the caller hands over and will not touch again. A large one is kept as
     * a chunk of its own instead of being copied, a small one is copied like any other write.
     */
    append(bytes) {
        if (bytes.length >= this.maxChunkSize / 2) {
            this.flush();
            this.chunks.push(bytes);
        }
        else {
            this.writeBytes(bytes);
        }
    }
    flush() {
        if (this.buffer && this.bufferPos) {
            this.chunks.push(this.buffer.slice(0, this.bufferPos));
            this.bufferPos = 0;
        }
    }
    finalize() {
        this.flush();
        // convert an array of arraybuffers into a blob and then back into a single arraybuffer
        return (0, decode_strings_js_1.blobToArrayBuffer)(new Blob(this.chunks, { type: 'application/octet-stream' }));
    }
}
exports.default = ChunkWriter;
Object.defineProperty(exports.default, 'default', { value: exports.default, enumerable: false, writable: true, configurable: true });
module.exports = exports.default;
//# sourceMappingURL=chunk-writer.js.map
},
"./decode-strings.js":function(module,exports,require){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ENCODING_LABELS = exports.isWsp = exports.textEncoder = void 0;
exports.decodeBase64 = decodeBase64;
exports.getDecoder = getDecoder;
exports.isUtf8 = isUtf8;
exports.decodeUtf8OrWindows1252 = decodeUtf8OrWindows1252;
exports.decodeCharset = decodeCharset;
exports.decodeText = decodeText;
exports.blobToArrayBuffer = blobToArrayBuffer;
exports.hexNibble = hexNibble;
exports.foldLineBreaks = foldLineBreaks;
exports.decodeWord = decodeWord;
exports.isEncodedWordsOnly = isEncodedWordsOnly;
exports.decodeWords = decodeWords;
exports.decodeURIComponentWithCharset = decodeURIComponentWithCharset;
exports.decodeParameterValueContinuations = decodeParameterValueContinuations;
exports.textEncoder = new TextEncoder();
/** SP or HTAB, the only whitespace RFC 5322 and RFC 2045 give a meaning to in a line */
const isWsp = (c) => c === 0x20 || c === 0x09;
exports.isWsp = isWsp;
const base64Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
// Use a lookup table to find the index.
const base64Lookup = new Uint8Array(256);
for (let i = 0; i < base64Chars.length; i++) {
    base64Lookup[base64Chars.charCodeAt(i)] = i;
}
function decodeBase64(base64) {
    // Padding carries no data, so the byte count comes from the payload alone. Sizing the
    // buffer from the raw length instead treated '=' as a data character and left the
    // output padded with NUL bytes, which then travelled into subjects and filenames.
    let len = base64.length;
    while (len > 0 && base64.charAt(len - 1) === '=') {
        len--;
    }
    // A remainder of one character cannot encode a byte, it is a truncated group
    if (len % 4 === 1) {
        len--;
    }
    const remainder = len % 4;
    const bufferLength = Math.floor(len / 4) * 3 + (remainder ? remainder - 1 : 0);
    const arrayBuffer = new ArrayBuffer(bufferLength);
    const bytes = new Uint8Array(arrayBuffer);
    let p = 0;
    for (let i = 0; i < len; i += 4) {
        let encoded1 = base64Lookup[base64.charCodeAt(i)];
        let encoded2 = base64Lookup[base64.charCodeAt(i + 1)];
        let encoded3 = base64Lookup[base64.charCodeAt(i + 2)];
        let encoded4 = base64Lookup[base64.charCodeAt(i + 3)];
        bytes[p++] = (encoded1 << 2) | (encoded2 >> 4);
        if (p < bufferLength) {
            bytes[p++] = ((encoded2 & 15) << 4) | (encoded3 >> 2);
        }
        if (p < bufferLength) {
            bytes[p++] = ((encoded3 & 3) << 6) | (encoded4 & 63);
        }
    }
    return arrayBuffer;
}
// Charset labels the WHATWG Encoding Standard does not list, but that name an encoding
// TextDecoder can decode. Without an entry the TextDecoder constructor throws and
// getDecoder falls back to windows-1252, turning the body into mojibake with nothing to
// signal that the wrong decoder was used.
//
// Keys are normalized (see normalizeCharset), so one entry covers every spelling of a
// label, eg. `eucjp` also catches `euc_jp`, `x-eucjp` and `x-euc-jp`. Only labels that
// need real encoding knowledge belong here; anything that differs from a supported
// label by nothing but an `x-` prefix or a separator is handled by normalization alone.
const charsetAliases = new Map([
    // Hebrew. The logical and explicit ordering variants share the iso-8859-8 index.
    ['iso88598i', 'iso-8859-8'],
    ['iso88598e', 'iso-8859-8'],
    // Japanese. WHATWG shift_jis is the Windows-31J index, so cp932 text decodes
    // identically, including the NEC and IBM extension rows.
    ['shiftjis', 'shift_jis'],
    ['windows31j', 'shift_jis'],
    ['mskanji', 'shift_jis'],
    ['eucjp', 'euc-jp'],
    // ISO-2022-JP, including the -1 / -2 supersets. Escape sequences outside plain
    // ISO-2022-JP (JIS X 0212, the non-Japanese G2 sets, and the SO/SI katakana shifts
    // cp50222 uses) decode to replacement characters, but the Japanese text around them
    // still comes out right.
    ['iso2022jp', 'iso-2022-jp'],
    ['iso2022jp1', 'iso-2022-jp'],
    ['iso2022jp2', 'iso-2022-jp'],
    ['junet', 'iso-2022-jp'],
    // Korean. The WHATWG euc-kr index is the extended cp949 / UHC index.
    ['euckr', 'euc-kr'],
    ['uhc', 'euc-kr'],
    // Thai.
    ['tis620', 'windows-874']
]);
// Windows and IBM code page numbers, as written in labels like cp932, windows-932, ms932
// or ibm932. An explicit allowlist rather than a derived one, because plenty of code
// pages that appear in mail (cp437, cp850, cp1361) have no equivalent to map onto and
// have to keep falling back.
const codePageAliases = new Map([
    ['932', 'shift_jis'],
    ['936', 'gbk'],
    ['949', 'euc-kr'],
    ['950', 'big5'],
    ['874', 'windows-874'],
    // Microsoft's EUC-JP and ISO-2022-JP variants. euc-jp and iso-2022-jp cover
    // everything they can express.
    ['51932', 'euc-jp'],
    ['50220', 'iso-2022-jp'],
    ['50221', 'iso-2022-jp'],
    ['50222', 'iso-2022-jp']
]);
const codePagePattern = /^(?:cp|windows|ms|ibm)(\d+)$/;
// Strip the decorations mail clients add to an otherwise standard label: an x- vendor
// prefix, the IANA cs- prefix, and any separators.
function normalizeCharset(charset) {
    return charset.replace(/^(?:x-ms-|x-|cs)/, '').replace(/[\s._-]+/g, '');
}
// Every label of the WHATWG Encoding Standard, https://encoding.spec.whatwg.org/encodings.json,
// but for the UTF-16 family, which UTF16_LABELS resolves on its own.
//
// TextDecoder accepts these and nothing else, so a label outside the list is turned away
// without constructing a decoder for it. Letting the constructor throw instead costs
// several times the decode itself, and a message controls how often it happens: once
// per encoded word, twice when the label also fails after normalization.
exports.ENCODING_LABELS = new Set([
    // UTF-8
    'unicode-1-1-utf-8 unicode11utf8 unicode20utf8 utf-8 utf8 x-unicode20utf8',
    // IBM866
    '866 cp866 csibm866 ibm866',
    // ISO-8859-2
    'csisolatin2 iso-8859-2 iso-ir-101 iso8859-2 iso88592 iso_8859-2 iso_8859-2:1987 l2 latin2',
    // ISO-8859-3
    'csisolatin3 iso-8859-3 iso-ir-109 iso8859-3 iso88593 iso_8859-3 iso_8859-3:1988 l3 latin3',
    // ISO-8859-4
    'csisolatin4 iso-8859-4 iso-ir-110 iso8859-4 iso88594 iso_8859-4 iso_8859-4:1988 l4 latin4',
    // ISO-8859-5
    'csisolatincyrillic cyrillic iso-8859-5 iso-ir-144 iso8859-5 iso88595 iso_8859-5 iso_8859-5:1988',
    // ISO-8859-6
    'arabic asmo-708 csiso88596e csiso88596i csisolatinarabic ecma-114 iso-8859-6 iso-8859-6-e',
    'iso-8859-6-i iso-ir-127 iso8859-6 iso88596 iso_8859-6 iso_8859-6:1987',
    // ISO-8859-7
    'csisolatingreek ecma-118 elot_928 greek greek8 iso-8859-7 iso-ir-126 iso8859-7 iso88597 iso_8859-7',
    'iso_8859-7:1987 sun_eu_greek',
    // ISO-8859-8
    'csiso88598e csisolatinhebrew hebrew iso-8859-8 iso-8859-8-e iso-ir-138 iso8859-8 iso88598 iso_8859-8',
    'iso_8859-8:1988 visual',
    // ISO-8859-8-I
    'csiso88598i iso-8859-8-i logical',
    // ISO-8859-10
    'csisolatin6 iso-8859-10 iso-ir-157 iso8859-10 iso885910 l6 latin6',
    // ISO-8859-13
    'iso-8859-13 iso8859-13 iso885913',
    // ISO-8859-14
    'iso-8859-14 iso8859-14 iso885914',
    // ISO-8859-15
    'csisolatin9 iso-8859-15 iso8859-15 iso885915 iso_8859-15 l9',
    // ISO-8859-16
    'iso-8859-16',
    // KOI8-R
    'cskoi8r koi koi8 koi8-r koi8_r',
    // KOI8-U
    'koi8-ru koi8-u',
    // macintosh
    'csmacintosh mac macintosh x-mac-roman',
    // windows-874
    'dos-874 iso-8859-11 iso8859-11 iso885911 tis-620 windows-874',
    // windows-1250
    'cp1250 windows-1250 x-cp1250',
    // windows-1251
    'cp1251 windows-1251 x-cp1251',
    // windows-1252
    'ansi_x3.4-1968 ascii cp1252 cp819 csisolatin1 ibm819 iso-8859-1 iso-ir-100 iso8859-1 iso88591',
    'iso_8859-1 iso_8859-1:1987 l1 latin1 us-ascii windows-1252 x-cp1252',
    // windows-1253
    'cp1253 windows-1253 x-cp1253',
    // windows-1254
    'cp1254 csisolatin5 iso-8859-9 iso-ir-148 iso8859-9 iso88599 iso_8859-9 iso_8859-9:1989 l5 latin5',
    'windows-1254 x-cp1254',
    // windows-1255
    'cp1255 windows-1255 x-cp1255',
    // windows-1256
    'cp1256 windows-1256 x-cp1256',
    // windows-1257
    'cp1257 windows-1257 x-cp1257',
    // windows-1258
    'cp1258 windows-1258 x-cp1258',
    // x-mac-cyrillic
    'x-mac-cyrillic x-mac-ukrainian',
    // GBK
    'chinese csgb2312 csiso58gb231280 gb2312 gb_2312 gb_2312-80 gbk iso-ir-58 x-gbk',
    // gb18030
    'gb18030',
    // Big5
    'big5 big5-hkscs cn-big5 csbig5 x-x-big5',
    // EUC-JP
    'cseucpkdfmtjapanese euc-jp x-euc-jp',
    // ISO-2022-JP
    'csiso2022jp iso-2022-jp',
    // Shift_JIS
    'csshiftjis ms932 ms_kanji shift-jis shift_jis sjis windows-31j x-sjis',
    // EUC-KR
    'cseuckr csksc56011987 euc-kr iso-ir-149 korean ks_c_5601-1987 ks_c_5601-1989 ksc5601 ksc_5601',
    'windows-949',
    // replacement
    'csiso2022kr hz-gb-2312 iso-2022-cn iso-2022-cn-ext iso-2022-kr replacement',
    // x-user-defined
    'x-user-defined'
]
    .join(' ')
    .split(' '));
// The labels the Encoding Standard maps to the replacement encoding: ISO-2022-KR,
// ISO-2022-CN and HZ-GB-2312, whose escape and shift sequences let the same bytes read as
// text to one decoder and as markup to another. A browser decodes a document in any of
// them to a single U+FFFD for that reason, and TextDecoder refuses to be constructed for
// them. They used to fall through to the UTF-8 or windows-1252 reading, which is the
// markup reading: a body of `ESC$)C SO <img onerror=…> SI` under charset=iso-2022-kr is
// Hangul to Python and a scanner built on it, and was an image tag here.
const REPLACEMENT_LABELS = new Set([
    'csiso2022kr',
    'hz-gb-2312',
    'iso-2022-cn',
    'iso-2022-cn-ext',
    'iso-2022-kr',
    'replacement'
]);
// The decoder of the replacement encoding: U+FFFD once there is a byte to replace
const replacementDecoder = {
    encoding: 'replacement',
    decode: input => (input && input.byteLength ? '�' : '')
};
// The UTF-16 labels honoured and the label of the standard each stands for: the spellings
// that Python and iconv-lite both decode, and nothing else. Matched as written only, never
// after normalization: `x-utf16` is known to neither.
//
// A label that one of the two reads and the other does not is the split this table
// exists to close: under it a scanner built on the other reads the bytes as single byte
// text, NUL interleaved and inert, where they decoded to markup here. So the standard's
// `unicode`, `csunicode`, `iso-10646-ucs-2`, `unicodefeff` and `unicodefffe`, which
// neither knows, are out, and so are `ucs-2`, `ucs2`, `utf16le` and `utf16be`, which
// iconv-lite alone knows (and `ucs-2` as little endian whatever mark the bytes carry).
// They all fall back like any unknown label.
const UTF16_LABELS = new Map([
    ['utf-16', 'utf-16'],
    ['utf16', 'utf-16'],
    ['utf_16', 'utf-16'],
    ['utf-16le', 'utf-16le'],
    ['utf-16be', 'utf-16be']
]);
/**
 * The label of the Encoding Standard a charset resolves to, as written or through the
 * alias tables, or null when it names no encoding the standard lists
 */
function resolveLabel(charset) {
    charset = (charset || 'utf8').trim().toLowerCase();
    // The label as written first, so the alias table only ever adds to what the standard
    // lists instead of shadowing it
    if (exports.ENCODING_LABELS.has(charset)) {
        return charset;
    }
    const utf16 = UTF16_LABELS.get(charset);
    if (utf16) {
        return utf16;
    }
    const normalized = normalizeCharset(charset);
    const codePage = normalized.match(codePagePattern);
    // The normalized label is itself the last candidate, which resolves everything that
    // differed from a listed label only by a prefix or a separator, eg. x-big5.
    const alias = (codePage && codePageAliases.get(codePage[1])) || charsetAliases.get(normalized) || normalized;
    return exports.ENCODING_LABELS.has(alias) ? alias : null;
}
// Decoders by label, or null where the runtime refuses the label (an encoding a runtime
// was built without). Only labels from the list above are stored, so the map can not grow
// past it however many labels a message makes up.
//
// Sharing a decoder is safe because nothing decodes with `stream: true`, so every
// decode() call starts from a fresh state.
const decoders = new Map();
function tryDecoder(label) {
    if (REPLACEMENT_LABELS.has(label)) {
        return replacementDecoder;
    }
    let decoder = decoders.get(label);
    if (decoder === undefined) {
        decoder = null;
        try {
            decoder = new TextDecoder(label);
        }
        catch {
            // not supported by this runtime
        }
        decoders.set(label, decoder);
    }
    return decoder;
}
// Every runtime has utf-8, so a decoder is always returned even where windows-1252 is
// missing, rather than letting the caller fail on a null decoder
const utf8Decoder = new TextDecoder();
/**
 * Finds the decoder for a charset label, or null when the runtime has no encoding for it
 */
function findDecoder(charset) {
    const label = resolveLabel(charset);
    return label ? tryDecoder(label) : null;
}
function getDecoder(charset) {
    return findDecoder(charset) || tryDecoder('windows-1252') || utf8Decoder;
}
const UTF16_ENCODINGS = new Set(['utf-16le', 'utf-16be']);
// The label of UTF-16 that leaves the byte order to the bytes, which a byte order mark
// then decides, as it does for Python's utf-16 codec and for iconv-lite. The labels that
// name the order, utf-16le and utf-16be, are read as they say whatever mark the bytes
// carry, and no label honours a UTF-8 mark. The Encoding Standard lets any mark override
// any label, but Python and mailparser do not, and following it here rendered as markup
// under charset=utf-16be a body that a scanner built on either reads as CJK text.
const UTF16_UNORDERED_LABELS = new Set(['utf-16']);
/**
 * The byte order a UTF-16 byte order mark at the start of the bytes names, or null without one
 */
function bomByteOrder(bytes) {
    if (bytes[0] === 0xfe && bytes[1] === 0xff) {
        return 'utf-16be';
    }
    if (bytes[0] === 0xff && bytes[1] === 0xfe) {
        return 'utf-16le';
    }
    return null;
}
/**
 * Whether the bytes are well formed UTF-8. A scan rather than a fatal TextDecoder, since
 * the exception one throws costs more than the decode itself and a message decides how
 * many lines throw it.
 */
function isUtf8(bytes) {
    for (let i = 0; i < bytes.length;) {
        const lead = bytes[i];
        if (lead < 0x80) {
            i++;
            continue;
        }
        // The number of continuation bytes, and the range the first of them may take,
        // which is what rules out overlong forms, surrogates and code points past U+10FFFF
        let count;
        if (lead >= 0xc2 && lead <= 0xdf) {
            count = 1;
        }
        else if (lead >= 0xe0 && lead <= 0xef) {
            count = 2;
        }
        else if (lead >= 0xf0 && lead <= 0xf4) {
            count = 3;
        }
        else {
            return false;
        }
        if (i + count >= bytes.length) {
            return false;
        }
        const second = bytes[i + 1];
        const min = lead === 0xe0 ? 0xa0 : lead === 0xf0 ? 0x90 : 0x80;
        const max = lead === 0xed ? 0x9f : lead === 0xf4 ? 0x8f : 0xbf;
        if (second < min || second > max) {
            return false;
        }
        for (let k = 2; k <= count; k++) {
            if ((bytes[i + k] & 0xc0) !== 0x80) {
                return false;
            }
        }
        i += count + 1;
    }
    return true;
}
/**
 * Decodes bytes whose encoding is not known: as UTF-8 when they are well formed UTF-8, as
 * windows-1252 otherwise.
 *
 * A message that declares no charset, or one the runtime has never heard of, usually
 * predates RFC 6532 or comes from a generator that never heard of it either, and its 8-bit
 * bytes are a legacy single byte encoding far more often than broken UTF-8. windows-1252
 * is the fallback the WHATWG Encoding Standard prescribes and what a mail client's default
 * charset amounts to, and it reads such text rather than filling it with replacement
 * characters.
 *
 * @param bytes Bytes to decode
 * @param utf8 The UTF-8 decoder to use, header lines bring one that keeps a BOM
 * @return Decoded text
 */
function decodeUtf8OrWindows1252(bytes, utf8 = utf8Decoder) {
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    return isUtf8(view) ? utf8.decode(view) : getDecoder('windows-1252').decode(view);
}
/**
 * Decodes bytes in a named charset. A label the runtime does not know is no charset at
 * all, see decodeUtf8OrWindows1252.
 *
 * @param bytes Bytes to decode
 * @param charset Charset label
 * @return Decoded text
 */
function decodeCharset(bytes, charset) {
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const label = resolveLabel(charset);
    let decoder = label ? tryDecoder(label) : null;
    if (label && UTF16_UNORDERED_LABELS.has(label)) {
        // `utf-16` reads as little endian on its own, so a byte order mark decides the
        // order. Read in the other order the bytes are swapped pairs of the characters
        // every other reader got: FE FF and big endian text under charset=utf-16 was CJK
        // text to Python and a browser, and here it was the little endian reading, which
        // the sender picks to be markup.
        const order = bomByteOrder(view);
        decoder = (order && tryDecoder(order)) || decoder;
    }
    return decoder ? decoder.decode(view) : decodeUtf8OrWindows1252(view);
}
// The charset an html document names for itself, in a `<meta charset>` or in the
// Content-Type `<meta http-equiv>`, read from the first 1024 bytes like a browser's prescan.
// Tags are found with indexOf and the attribute is matched inside one tag at a time: a
// single pattern over the whole head rescans it once for every `<meta` in it, and a head of
// nothing but `<meta ` took it quadratic
const META_PRESCAN_BYTES = 1024;
const CHARSET_ATTRIBUTE = /charset\s*=\s*["']?\s*([^\s"';>]+)/;
function sniffHtmlCharset(bytes) {
    const head = utf8Decoder.decode(bytes.subarray(0, META_PRESCAN_BYTES)).toLowerCase();
    let pos = 0;
    while ((pos = head.indexOf('<meta', pos)) >= 0) {
        let end = head.indexOf('>', pos);
        if (end < 0) {
            end = head.length;
        }
        const match = CHARSET_ATTRIBUTE.exec(head.slice(pos, end));
        if (match) {
            return match[1];
        }
        pos = end;
    }
    return null;
}
/**
 * Decodes the bytes of a text part: in the declared charset, otherwise in the one an html
 * part names for itself, otherwise as UTF-8 or windows-1252 depending on what the bytes
 * turn out to be, see decodeUtf8OrWindows1252.
 *
 * @param bytes Decoded body of the part
 * @param charset The charset parameter of the Content-Type, if any
 * @param html Whether the part is html, which may name its own charset
 * @return The text of the part
 */
function decodeText(bytes, charset, html) {
    const view = new Uint8Array(bytes);
    if (charset) {
        return decodeCharset(view, charset);
    }
    // The HTML prescan has two overrides, and for a reason: a `<meta>` tag that could be
    // read as ASCII proves the document is not UTF-16, so such a label is read as UTF-8,
    // and x-user-defined is read as windows-1252. Without them a sender picks the encoding
    // that turns bytes a scanner sees as inert into markup for this parser alone. A label
    // of the replacement encoding is the replacement text, as it is for a browser, see
    // tryDecoder
    const sniffed = html ? sniffHtmlCharset(view) : null;
    const decoder = sniffed ? findDecoder(sniffed) : null;
    if (!decoder || UTF16_ENCODINGS.has(decoder.encoding)) {
        return decodeUtf8OrWindows1252(view);
    }
    return (decoder.encoding === 'x-user-defined' ? getDecoder('windows-1252') : decoder).decode(view);
}
/**
 * Converts a Blob into an ArrayBuffer
 * @param blob Blob to convert
 * @returns Converted value
 */
async function blobToArrayBuffer(blob) {
    if ('arrayBuffer' in blob) {
        return await blob.arrayBuffer();
    }
    const fr = new FileReader();
    return new Promise((resolve, reject) => {
        fr.onload = () => {
            resolve(fr.result);
        };
        fr.onerror = () => {
            reject(fr.error);
        };
        fr.readAsArrayBuffer(blob);
    });
}
/**
 * Numeric value of an ASCII hex digit
 *
 * @param c Byte to read
 * @return Value 0-15, or -1 if the byte is not a hex digit
 */
function hexNibble(c) {
    if (c >= 0x30 /* 0 */ && c <= 0x39 /* 9 */) {
        return c - 0x30;
    }
    if (c >= 0x61 /* a */ && c <= 0x66 /* f */) {
        return c - 0x61 + 10;
    }
    if (c >= 0x41 /* A */ && c <= 0x46 /* F */) {
        return c - 0x41 + 10;
    }
    return -1;
}
/**
 * Folds the line breaks of a header value into spaces.
 *
 * A header value holds no line breaks. The raw value is folded when the headers are
 * processed, see processHeaders in mime-node.ts, an RFC 2047 encoded word is folded as it
 * is decoded, and an RFC 2231 filename is folded where the attachment is built. Otherwise a
 * decoded name, subject or filename written into a header of an outgoing message by the
 * consumer ends the header early and starts another one with the rest of the value.
 *
 * The RFC 2231 percent decoder itself does not fold: it also produces the boundary, and a
 * boundary holding a line break can never match a line. That has to stay so, or a message
 * that has no parts for every other parser would have them here.
 *
 * @param str Header value
 * @return The value with every run of CR and LF replaced by a space
 */
function foldLineBreaks(str) {
    return str.replace(/[\r\n]+/g, ' ');
}
/**
 * Decode a complete mime word encoded string
 *
 * @param charset Character set of the encoded word
 * @param encoding `Q` or `B`
 * @param str Mime word encoded string
 * @return Decoded unicode string
 */
function decodeWord(charset, encoding, str) {
    // RFC2231 added language tag to the encoding
    // see: https://tools.ietf.org/html/rfc2231#section-5
    // this implementation silently ignores this tag
    let splitPos = charset.indexOf('*');
    if (splitPos >= 0) {
        charset = charset.slice(0, splitPos);
    }
    encoding = encoding.toUpperCase();
    let byteStr;
    if (encoding === 'Q') {
        str = str
            // remove spaces between = and hex char, this might indicate invalidly applied line splitting
            .replace(/=\s+([0-9a-fA-F])/g, '=$1')
            // convert all underscores to spaces
            .replace(/[_\s]/g, ' ');
        let buf = exports.textEncoder.encode(str);
        let encodedBytes = [];
        for (let i = 0, len = buf.length; i < len; i++) {
            let c = buf[i];
            if (i <= len - 2 && c === 0x3d /* = */) {
                let high = hexNibble(buf[i + 1]);
                let low = hexNibble(buf[i + 2]);
                if (high >= 0 && low >= 0) {
                    encodedBytes.push((high << 4) | low);
                    i += 2;
                    continue;
                }
            }
            encodedBytes.push(c);
        }
        byteStr = new ArrayBuffer(encodedBytes.length);
        let dataView = new DataView(byteStr);
        for (let i = 0, len = encodedBytes.length; i < len; i++) {
            dataView.setUint8(i, encodedBytes[i]);
        }
    }
    else if (encoding === 'B') {
        byteStr = decodeBase64(str.replace(/[^a-zA-Z0-9\+\/=]+/g, ''));
    }
    else {
        // keep as is, convert ArrayBuffer to unicode string, assume utf8
        byteStr = exports.textEncoder.encode(str);
    }
    return foldLineBreaks(decodeCharset(byteStr, charset));
}
// A charset label runs to the next '?' so that labels containing punctuation, eg.
// ISO_8859-1:1987, are recognised. Whitespace is excluded so a stray '=?' in running text
// can not swallow the rest of the line.
const ENCODED_WORD_PATTERN = '=\\?([^?\\s]+)\\?([QqBb])\\?([^?]*)\\?=';
const ENCODED_WORD_REGEX = new RegExp(ENCODED_WORD_PATTERN, 'g');
// Only linear whitespace separates encoded words, the rest is content
const WORD_SEPARATOR_REGEX = /^[ \t\r\n]+$/;
const ENCODED_WORDS_ONLY_REGEX = new RegExp(`^(?:${ENCODED_WORD_PATTERN}\\s*)+$`);
/**
 * Checks whether a string is nothing but RFC 2047 encoded words. Kept next to the grammar
 * it depends on, so the pattern has a single definition.
 *
 * @param str String to check
 * @return true if the string holds encoded words and nothing else
 */
function isEncodedWordsOnly(str) {
    return ENCODED_WORDS_ONLY_REGEX.test(str);
}
/**
 * Splits a string into encoded words and the literal text around them.
 *
 * Working on a token list rather than marking joinable words with an in band sentinel
 * means the input can not contain the marker, which previously let a sender delete text
 * from a subject or a display name by writing the marker into the header themselves.
 *
 * @param str String to split
 * @return Array of `{text}` and `{charset, encoding, encodedText}` tokens
 */
function splitEncodedWords(str) {
    const tokens = [];
    ENCODED_WORD_REGEX.lastIndex = 0;
    let pos = 0;
    let match;
    while ((match = ENCODED_WORD_REGEX.exec(str))) {
        if (match.index > pos) {
            tokens.push({ text: str.substring(pos, match.index) });
        }
        tokens.push({ charset: match[1], encoding: match[2], encodedText: match[3] });
        pos = match.index + match[0].length;
    }
    if (pos < str.length) {
        tokens.push({ text: str.substring(pos) });
    }
    return tokens;
}
/**
 * Checks if two adjacent encoded words may be decoded as a single unit. A multi byte
 * character is often split across two words, so the bytes have to be concatenated before
 * they are decoded. Base64 additionally needs the left chunk to end on a group boundary,
 * otherwise the concatenation shifts every byte that follows.
 */
function canJoinWords(left, right) {
    const encoding = left.encoding.toUpperCase();
    if (left.charset !== right.charset || encoding !== right.encoding.toUpperCase()) {
        return false;
    }
    if (encoding === 'B') {
        // The length of a string built by concatenation is stored with it, but a regex or
        // endsWith on it flattens everything joined so far first. Testing the growing text
        // for a pad on every word made a subject of a hundred thousand short words cost
        // seconds, so the pad is tracked as the words are appended instead.
        return left.encodedText.length % 4 === 0 && !left.padded;
    }
    return true;
}
/**
 * Decodes a token list into a string, optionally merging adjacent encoded words.
 *
 * @param tokens Tokens from splitEncodedWords
 * @param joinWords Whether adjacent encoded words may be decoded as one unit
 * @return Decoded string
 */
function renderTokens(tokens, joinWords) {
    let result = '';
    let pending = null;
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        if (token.text !== undefined) {
            // whitespace between two encoded words is a folding artifact, not content
            const nextToken = tokens[i + 1];
            if (pending && nextToken && nextToken.text === undefined && WORD_SEPARATOR_REGEX.test(token.text)) {
                continue;
            }
            if (pending) {
                result += decodeWord(pending.charset, pending.encoding, pending.encodedText);
                pending = null;
            }
            result += token.text;
            continue;
        }
        if (pending && joinWords && canJoinWords(pending, token)) {
            pending.encodedText += token.encodedText;
            pending.padded = token.encodedText.endsWith('=');
            continue;
        }
        if (pending) {
            result += decodeWord(pending.charset, pending.encoding, pending.encodedText);
        }
        pending = {
            charset: token.charset,
            encoding: token.encoding,
            encodedText: token.encodedText,
            padded: token.encodedText.endsWith('=')
        };
    }
    if (pending) {
        result += decodeWord(pending.charset, pending.encoding, pending.encodedText);
    }
    return result;
}
/**
 * Decodes RFC 2047 encoded words in a string
 *
 * @param str String that may contain encoded words
 * @return Unicode string with every encoded word decoded
 */
function decodeWords(str) {
    const tokens = splitEncodedWords((str || '').toString());
    const result = renderTokens(tokens, true);
    // A replacement character means the bytes did not decode, which happens when two
    // words were joined that should have stayed apart. Retry keeping them separate.
    return result.indexOf('\ufffd') < 0 ? result : renderTokens(tokens, false);
}
function decodeURIComponentWithCharset(encodedStr, charset) {
    charset = charset || 'utf-8';
    let encodedBytes = [];
    for (let i = 0; i < encodedStr.length; i++) {
        let c = encodedStr.charAt(i);
        // -1 past the end of the string as well, since charCodeAt returns NaN there
        const high = c === '%' ? hexNibble(encodedStr.charCodeAt(i + 1)) : -1;
        const low = high >= 0 ? hexNibble(encodedStr.charCodeAt(i + 2)) : -1;
        if (low >= 0) {
            // encoded sequence
            encodedBytes.push((high << 4) | low);
            i += 2;
        }
        else if (c.charCodeAt(0) > 126) {
            const bytes = exports.textEncoder.encode(c);
            for (let j = 0; j < bytes.length; j++) {
                encodedBytes.push(bytes[j]);
            }
        }
        else {
            // "normal" char
            encodedBytes.push(c.charCodeAt(0));
        }
    }
    const byteStr = new ArrayBuffer(encodedBytes.length);
    const dataView = new DataView(byteStr);
    for (let i = 0, len = encodedBytes.length; i < len; i++) {
        dataView.setUint8(i, encodedBytes[i]);
    }
    return decodeCharset(byteStr, charset);
}
function decodeParameterValueContinuations(header) {
    // handle parameter value continuations
    // https://tools.ietf.org/html/rfc2231#section-3
    // preprocess values
    let paramKeys = new Map();
    Object.keys(header.params).forEach(key => {
        let match = key.match(/\*((\d+)\*?)?$/);
        if (!match) {
            // nothing to do here, does not seem like a continuation param
            return;
        }
        let actualKey = key.slice(0, match.index).toLowerCase();
        let nr = Number(match[2]) || 0;
        let paramVal = paramKeys.get(actualKey);
        if (!paramVal) {
            paramVal = {
                charset: null,
                values: []
            };
            paramKeys.set(actualKey, paramVal);
        }
        let value = header.params[key];
        // RFC 2231 section 4.1: only a section whose name ends in '*' is percent encoded.
        // A plain `name*0=` section is literal text, so decoding it invents characters
        // that never appeared on the wire, turning `a%2F..%2Fetc` into a path traversal.
        let encoded = match[0].charAt(match[0].length - 1) === '*';
        if (nr === 0 && encoded && (match = value.match(/^([^']*)'[^']*'(.*)$/))) {
            paramVal.charset = match[1] || 'utf-8';
            value = match[2];
        }
        paramVal.values.push({ nr, value, encoded });
        // remove the old reference
        delete header.params[key];
    });
    paramKeys.forEach((paramVal, key) => {
        if (Object.prototype.hasOwnProperty.call(header.params, key)) {
            // The same name was also given as a plain parameter, which the starred keys were
            // just deleted from around, so this write would be the only one here to override a
            // name already taken. `filename="plain"; filename*0="cont"` resolves to the plain
            // parameter either way round, so the reading does not come down to which of the
            // two spellings the sender put first. See storeParam in mime-node.ts
            return;
        }
        let result = '';
        // Adjacent encoded sections are decoded together, because a single multi byte
        // character may be percent encoded across a section boundary.
        let pending = '';
        for (let part of paramVal.values.sort((a, b) => a.nr - b.nr)) {
            if (part.encoded) {
                pending += part.value;
                continue;
            }
            if (pending) {
                result += decodeURIComponentWithCharset(pending, paramVal.charset);
                pending = '';
            }
            result += part.value;
        }
        if (pending) {
            result += decodeURIComponentWithCharset(pending, paramVal.charset);
        }
        header.params[key] = result;
    });
}
//# sourceMappingURL=decode-strings.js.map
},
"./errors.js":function(module,exports,require){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createError = createError;
// The error class each code is thrown as. An invalid option or input is a TypeError, as an
// invalid option was before codes were added
const ERROR_TYPES = {
    EINVALIDOPTION: TypeError,
    EINVALIDINPUT: TypeError,
    EPARSERREUSED: Error,
    EMAXNESTINGDEPTH: Error,
    EMAXHEADERSIZE: Error,
    EMAXPARTCOUNT: Error,
    EMAXFORWARDEDADDRESSES: Error
};
/**
 * Creates an error with a code
 *
 * @param code Error code
 * @param message Error message
 * @returns The error
 */
function createError(code, message) {
    const error = new ERROR_TYPES[code](message);
    error.code = code;
    return error;
}
//# sourceMappingURL=errors.js.map
},
"./html-entities.js":function(module,exports,require){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.htmlEntities = void 0;
// Entity map from https://html.spec.whatwg.org/multipage/named-characters.html#named-character-references
exports.htmlEntities = {
    '&AElig': '\u00C6',
    '&AElig;': '\u00C6',
    '&AMP': '\u0026',
    '&AMP;': '\u0026',
    '&Aacute': '\u00C1',
    '&Aacute;': '\u00C1',
    '&Abreve;': '\u0102',
    '&Acirc': '\u00C2',
    '&Acirc;': '\u00C2',
    '&Acy;': '\u0410',
    '&Afr;': '\uD835\uDD04',
    '&Agrave': '\u00C0',
    '&Agrave;': '\u00C0',
    '&Alpha;': '\u0391',
    '&Amacr;': '\u0100',
    '&And;': '\u2A53',
    '&Aogon;': '\u0104',
    '&Aopf;': '\uD835\uDD38',
    '&ApplyFunction;': '\u2061',
    '&Aring': '\u00C5',
    '&Aring;': '\u00C5',
    '&Ascr;': '\uD835\uDC9C',
    '&Assign;': '\u2254',
    '&Atilde': '\u00C3',
    '&Atilde;': '\u00C3',
    '&Auml': '\u00C4',
    '&Auml;': '\u00C4',
    '&Backslash;': '\u2216',
    '&Barv;': '\u2AE7',
    '&Barwed;': '\u2306',
    '&Bcy;': '\u0411',
    '&Because;': '\u2235',
    '&Bernoullis;': '\u212C',
    '&Beta;': '\u0392',
    '&Bfr;': '\uD835\uDD05',
    '&Bopf;': '\uD835\uDD39',
    '&Breve;': '\u02D8',
    '&Bscr;': '\u212C',
    '&Bumpeq;': '\u224E',
    '&CHcy;': '\u0427',
    '&COPY': '\u00A9',
    '&COPY;': '\u00A9',
    '&Cacute;': '\u0106',
    '&Cap;': '\u22D2',
    '&CapitalDifferentialD;': '\u2145',
    '&Cayleys;': '\u212D',
    '&Ccaron;': '\u010C',
    '&Ccedil': '\u00C7',
    '&Ccedil;': '\u00C7',
    '&Ccirc;': '\u0108',
    '&Cconint;': '\u2230',
    '&Cdot;': '\u010A',
    '&Cedilla;': '\u00B8',
    '&CenterDot;': '\u00B7',
    '&Cfr;': '\u212D',
    '&Chi;': '\u03A7',
    '&CircleDot;': '\u2299',
    '&CircleMinus;': '\u2296',
    '&CirclePlus;': '\u2295',
    '&CircleTimes;': '\u2297',
    '&ClockwiseContourIntegral;': '\u2232',
    '&CloseCurlyDoubleQuote;': '\u201D',
    '&CloseCurlyQuote;': '\u2019',
    '&Colon;': '\u2237',
    '&Colone;': '\u2A74',
    '&Congruent;': '\u2261',
    '&Conint;': '\u222F',
    '&ContourIntegral;': '\u222E',
    '&Copf;': '\u2102',
    '&Coproduct;': '\u2210',
    '&CounterClockwiseContourIntegral;': '\u2233',
    '&Cross;': '\u2A2F',
    '&Cscr;': '\uD835\uDC9E',
    '&Cup;': '\u22D3',
    '&CupCap;': '\u224D',
    '&DD;': '\u2145',
    '&DDotrahd;': '\u2911',
    '&DJcy;': '\u0402',
    '&DScy;': '\u0405',
    '&DZcy;': '\u040F',
    '&Dagger;': '\u2021',
    '&Darr;': '\u21A1',
    '&Dashv;': '\u2AE4',
    '&Dcaron;': '\u010E',
    '&Dcy;': '\u0414',
    '&Del;': '\u2207',
    '&Delta;': '\u0394',
    '&Dfr;': '\uD835\uDD07',
    '&DiacriticalAcute;': '\u00B4',
    '&DiacriticalDot;': '\u02D9',
    '&DiacriticalDoubleAcute;': '\u02DD',
    '&DiacriticalGrave;': '\u0060',
    '&DiacriticalTilde;': '\u02DC',
    '&Diamond;': '\u22C4',
    '&DifferentialD;': '\u2146',
    '&Dopf;': '\uD835\uDD3B',
    '&Dot;': '\u00A8',
    '&DotDot;': '\u20DC',
    '&DotEqual;': '\u2250',
    '&DoubleContourIntegral;': '\u222F',
    '&DoubleDot;': '\u00A8',
    '&DoubleDownArrow;': '\u21D3',
    '&DoubleLeftArrow;': '\u21D0',
    '&DoubleLeftRightArrow;': '\u21D4',
    '&DoubleLeftTee;': '\u2AE4',
    '&DoubleLongLeftArrow;': '\u27F8',
    '&DoubleLongLeftRightArrow;': '\u27FA',
    '&DoubleLongRightArrow;': '\u27F9',
    '&DoubleRightArrow;': '\u21D2',
    '&DoubleRightTee;': '\u22A8',
    '&DoubleUpArrow;': '\u21D1',
    '&DoubleUpDownArrow;': '\u21D5',
    '&DoubleVerticalBar;': '\u2225',
    '&DownArrow;': '\u2193',
    '&DownArrowBar;': '\u2913',
    '&DownArrowUpArrow;': '\u21F5',
    '&DownBreve;': '\u0311',
    '&DownLeftRightVector;': '\u2950',
    '&DownLeftTeeVector;': '\u295E',
    '&DownLeftVector;': '\u21BD',
    '&DownLeftVectorBar;': '\u2956',
    '&DownRightTeeVector;': '\u295F',
    '&DownRightVector;': '\u21C1',
    '&DownRightVectorBar;': '\u2957',
    '&DownTee;': '\u22A4',
    '&DownTeeArrow;': '\u21A7',
    '&Downarrow;': '\u21D3',
    '&Dscr;': '\uD835\uDC9F',
    '&Dstrok;': '\u0110',
    '&ENG;': '\u014A',
    '&ETH': '\u00D0',
    '&ETH;': '\u00D0',
    '&Eacute': '\u00C9',
    '&Eacute;': '\u00C9',
    '&Ecaron;': '\u011A',
    '&Ecirc': '\u00CA',
    '&Ecirc;': '\u00CA',
    '&Ecy;': '\u042D',
    '&Edot;': '\u0116',
    '&Efr;': '\uD835\uDD08',
    '&Egrave': '\u00C8',
    '&Egrave;': '\u00C8',
    '&Element;': '\u2208',
    '&Emacr;': '\u0112',
    '&EmptySmallSquare;': '\u25FB',
    '&EmptyVerySmallSquare;': '\u25AB',
    '&Eogon;': '\u0118',
    '&Eopf;': '\uD835\uDD3C',
    '&Epsilon;': '\u0395',
    '&Equal;': '\u2A75',
    '&EqualTilde;': '\u2242',
    '&Equilibrium;': '\u21CC',
    '&Escr;': '\u2130',
    '&Esim;': '\u2A73',
    '&Eta;': '\u0397',
    '&Euml': '\u00CB',
    '&Euml;': '\u00CB',
    '&Exists;': '\u2203',
    '&ExponentialE;': '\u2147',
    '&Fcy;': '\u0424',
    '&Ffr;': '\uD835\uDD09',
    '&FilledSmallSquare;': '\u25FC',
    '&FilledVerySmallSquare;': '\u25AA',
    '&Fopf;': '\uD835\uDD3D',
    '&ForAll;': '\u2200',
    '&Fouriertrf;': '\u2131',
    '&Fscr;': '\u2131',
    '&GJcy;': '\u0403',
    '&GT': '\u003E',
    '&GT;': '\u003E',
    '&Gamma;': '\u0393',
    '&Gammad;': '\u03DC',
    '&Gbreve;': '\u011E',
    '&Gcedil;': '\u0122',
    '&Gcirc;': '\u011C',
    '&Gcy;': '\u0413',
    '&Gdot;': '\u0120',
    '&Gfr;': '\uD835\uDD0A',
    '&Gg;': '\u22D9',
    '&Gopf;': '\uD835\uDD3E',
    '&GreaterEqual;': '\u2265',
    '&GreaterEqualLess;': '\u22DB',
    '&GreaterFullEqual;': '\u2267',
    '&GreaterGreater;': '\u2AA2',
    '&GreaterLess;': '\u2277',
    '&GreaterSlantEqual;': '\u2A7E',
    '&GreaterTilde;': '\u2273',
    '&Gscr;': '\uD835\uDCA2',
    '&Gt;': '\u226B',
    '&HARDcy;': '\u042A',
    '&Hacek;': '\u02C7',
    '&Hat;': '\u005E',
    '&Hcirc;': '\u0124',
    '&Hfr;': '\u210C',
    '&HilbertSpace;': '\u210B',
    '&Hopf;': '\u210D',
    '&HorizontalLine;': '\u2500',
    '&Hscr;': '\u210B',
    '&Hstrok;': '\u0126',
    '&HumpDownHump;': '\u224E',
    '&HumpEqual;': '\u224F',
    '&IEcy;': '\u0415',
    '&IJlig;': '\u0132',
    '&IOcy;': '\u0401',
    '&Iacute': '\u00CD',
    '&Iacute;': '\u00CD',
    '&Icirc': '\u00CE',
    '&Icirc;': '\u00CE',
    '&Icy;': '\u0418',
    '&Idot;': '\u0130',
    '&Ifr;': '\u2111',
    '&Igrave': '\u00CC',
    '&Igrave;': '\u00CC',
    '&Im;': '\u2111',
    '&Imacr;': '\u012A',
    '&ImaginaryI;': '\u2148',
    '&Implies;': '\u21D2',
    '&Int;': '\u222C',
    '&Integral;': '\u222B',
    '&Intersection;': '\u22C2',
    '&InvisibleComma;': '\u2063',
    '&InvisibleTimes;': '\u2062',
    '&Iogon;': '\u012E',
    '&Iopf;': '\uD835\uDD40',
    '&Iota;': '\u0399',
    '&Iscr;': '\u2110',
    '&Itilde;': '\u0128',
    '&Iukcy;': '\u0406',
    '&Iuml': '\u00CF',
    '&Iuml;': '\u00CF',
    '&Jcirc;': '\u0134',
    '&Jcy;': '\u0419',
    '&Jfr;': '\uD835\uDD0D',
    '&Jopf;': '\uD835\uDD41',
    '&Jscr;': '\uD835\uDCA5',
    '&Jsercy;': '\u0408',
    '&Jukcy;': '\u0404',
    '&KHcy;': '\u0425',
    '&KJcy;': '\u040C',
    '&Kappa;': '\u039A',
    '&Kcedil;': '\u0136',
    '&Kcy;': '\u041A',
    '&Kfr;': '\uD835\uDD0E',
    '&Kopf;': '\uD835\uDD42',
    '&Kscr;': '\uD835\uDCA6',
    '&LJcy;': '\u0409',
    '&LT': '\u003C',
    '&LT;': '\u003C',
    '&Lacute;': '\u0139',
    '&Lambda;': '\u039B',
    '&Lang;': '\u27EA',
    '&Laplacetrf;': '\u2112',
    '&Larr;': '\u219E',
    '&Lcaron;': '\u013D',
    '&Lcedil;': '\u013B',
    '&Lcy;': '\u041B',
    '&LeftAngleBracket;': '\u27E8',
    '&LeftArrow;': '\u2190',
    '&LeftArrowBar;': '\u21E4',
    '&LeftArrowRightArrow;': '\u21C6',
    '&LeftCeiling;': '\u2308',
    '&LeftDoubleBracket;': '\u27E6',
    '&LeftDownTeeVector;': '\u2961',
    '&LeftDownVector;': '\u21C3',
    '&LeftDownVectorBar;': '\u2959',
    '&LeftFloor;': '\u230A',
    '&LeftRightArrow;': '\u2194',
    '&LeftRightVector;': '\u294E',
    '&LeftTee;': '\u22A3',
    '&LeftTeeArrow;': '\u21A4',
    '&LeftTeeVector;': '\u295A',
    '&LeftTriangle;': '\u22B2',
    '&LeftTriangleBar;': '\u29CF',
    '&LeftTriangleEqual;': '\u22B4',
    '&LeftUpDownVector;': '\u2951',
    '&LeftUpTeeVector;': '\u2960',
    '&LeftUpVector;': '\u21BF',
    '&LeftUpVectorBar;': '\u2958',
    '&LeftVector;': '\u21BC',
    '&LeftVectorBar;': '\u2952',
    '&Leftarrow;': '\u21D0',
    '&Leftrightarrow;': '\u21D4',
    '&LessEqualGreater;': '\u22DA',
    '&LessFullEqual;': '\u2266',
    '&LessGreater;': '\u2276',
    '&LessLess;': '\u2AA1',
    '&LessSlantEqual;': '\u2A7D',
    '&LessTilde;': '\u2272',
    '&Lfr;': '\uD835\uDD0F',
    '&Ll;': '\u22D8',
    '&Lleftarrow;': '\u21DA',
    '&Lmidot;': '\u013F',
    '&LongLeftArrow;': '\u27F5',
    '&LongLeftRightArrow;': '\u27F7',
    '&LongRightArrow;': '\u27F6',
    '&Longleftarrow;': '\u27F8',
    '&Longleftrightarrow;': '\u27FA',
    '&Longrightarrow;': '\u27F9',
    '&Lopf;': '\uD835\uDD43',
    '&LowerLeftArrow;': '\u2199',
    '&LowerRightArrow;': '\u2198',
    '&Lscr;': '\u2112',
    '&Lsh;': '\u21B0',
    '&Lstrok;': '\u0141',
    '&Lt;': '\u226A',
    '&Map;': '\u2905',
    '&Mcy;': '\u041C',
    '&MediumSpace;': '\u205F',
    '&Mellintrf;': '\u2133',
    '&Mfr;': '\uD835\uDD10',
    '&MinusPlus;': '\u2213',
    '&Mopf;': '\uD835\uDD44',
    '&Mscr;': '\u2133',
    '&Mu;': '\u039C',
    '&NJcy;': '\u040A',
    '&Nacute;': '\u0143',
    '&Ncaron;': '\u0147',
    '&Ncedil;': '\u0145',
    '&Ncy;': '\u041D',
    '&NegativeMediumSpace;': '\u200B',
    '&NegativeThickSpace;': '\u200B',
    '&NegativeThinSpace;': '\u200B',
    '&NegativeVeryThinSpace;': '\u200B',
    '&NestedGreaterGreater;': '\u226B',
    '&NestedLessLess;': '\u226A',
    '&NewLine;': '\u000A',
    '&Nfr;': '\uD835\uDD11',
    '&NoBreak;': '\u2060',
    '&NonBreakingSpace;': '\u00A0',
    '&Nopf;': '\u2115',
    '&Not;': '\u2AEC',
    '&NotCongruent;': '\u2262',
    '&NotCupCap;': '\u226D',
    '&NotDoubleVerticalBar;': '\u2226',
    '&NotElement;': '\u2209',
    '&NotEqual;': '\u2260',
    '&NotEqualTilde;': '\u2242\u0338',
    '&NotExists;': '\u2204',
    '&NotGreater;': '\u226F',
    '&NotGreaterEqual;': '\u2271',
    '&NotGreaterFullEqual;': '\u2267\u0338',
    '&NotGreaterGreater;': '\u226B\u0338',
    '&NotGreaterLess;': '\u2279',
    '&NotGreaterSlantEqual;': '\u2A7E\u0338',
    '&NotGreaterTilde;': '\u2275',
    '&NotHumpDownHump;': '\u224E\u0338',
    '&NotHumpEqual;': '\u224F\u0338',
    '&NotLeftTriangle;': '\u22EA',
    '&NotLeftTriangleBar;': '\u29CF\u0338',
    '&NotLeftTriangleEqual;': '\u22EC',
    '&NotLess;': '\u226E',
    '&NotLessEqual;': '\u2270',
    '&NotLessGreater;': '\u2278',
    '&NotLessLess;': '\u226A\u0338',
    '&NotLessSlantEqual;': '\u2A7D\u0338',
    '&NotLessTilde;': '\u2274',
    '&NotNestedGreaterGreater;': '\u2AA2\u0338',
    '&NotNestedLessLess;': '\u2AA1\u0338',
    '&NotPrecedes;': '\u2280',
    '&NotPrecedesEqual;': '\u2AAF\u0338',
    '&NotPrecedesSlantEqual;': '\u22E0',
    '&NotReverseElement;': '\u220C',
    '&NotRightTriangle;': '\u22EB',
    '&NotRightTriangleBar;': '\u29D0\u0338',
    '&NotRightTriangleEqual;': '\u22ED',
    '&NotSquareSubset;': '\u228F\u0338',
    '&NotSquareSubsetEqual;': '\u22E2',
    '&NotSquareSuperset;': '\u2290\u0338',
    '&NotSquareSupersetEqual;': '\u22E3',
    '&NotSubset;': '\u2282\u20D2',
    '&NotSubsetEqual;': '\u2288',
    '&NotSucceeds;': '\u2281',
    '&NotSucceedsEqual;': '\u2AB0\u0338',
    '&NotSucceedsSlantEqual;': '\u22E1',
    '&NotSucceedsTilde;': '\u227F\u0338',
    '&NotSuperset;': '\u2283\u20D2',
    '&NotSupersetEqual;': '\u2289',
    '&NotTilde;': '\u2241',
    '&NotTildeEqual;': '\u2244',
    '&NotTildeFullEqual;': '\u2247',
    '&NotTildeTilde;': '\u2249',
    '&NotVerticalBar;': '\u2224',
    '&Nscr;': '\uD835\uDCA9',
    '&Ntilde': '\u00D1',
    '&Ntilde;': '\u00D1',
    '&Nu;': '\u039D',
    '&OElig;': '\u0152',
    '&Oacute': '\u00D3',
    '&Oacute;': '\u00D3',
    '&Ocirc': '\u00D4',
    '&Ocirc;': '\u00D4',
    '&Ocy;': '\u041E',
    '&Odblac;': '\u0150',
    '&Ofr;': '\uD835\uDD12',
    '&Ograve': '\u00D2',
    '&Ograve;': '\u00D2',
    '&Omacr;': '\u014C',
    '&Omega;': '\u03A9',
    '&Omicron;': '\u039F',
    '&Oopf;': '\uD835\uDD46',
    '&OpenCurlyDoubleQuote;': '\u201C',
    '&OpenCurlyQuote;': '\u2018',
    '&Or;': '\u2A54',
    '&Oscr;': '\uD835\uDCAA',
    '&Oslash': '\u00D8',
    '&Oslash;': '\u00D8',
    '&Otilde': '\u00D5',
    '&Otilde;': '\u00D5',
    '&Otimes;': '\u2A37',
    '&Ouml': '\u00D6',
    '&Ouml;': '\u00D6',
    '&OverBar;': '\u203E',
    '&OverBrace;': '\u23DE',
    '&OverBracket;': '\u23B4',
    '&OverParenthesis;': '\u23DC',
    '&PartialD;': '\u2202',
    '&Pcy;': '\u041F',
    '&Pfr;': '\uD835\uDD13',
    '&Phi;': '\u03A6',
    '&Pi;': '\u03A0',
    '&PlusMinus;': '\u00B1',
    '&Poincareplane;': '\u210C',
    '&Popf;': '\u2119',
    '&Pr;': '\u2ABB',
    '&Precedes;': '\u227A',
    '&PrecedesEqual;': '\u2AAF',
    '&PrecedesSlantEqual;': '\u227C',
    '&PrecedesTilde;': '\u227E',
    '&Prime;': '\u2033',
    '&Product;': '\u220F',
    '&Proportion;': '\u2237',
    '&Proportional;': '\u221D',
    '&Pscr;': '\uD835\uDCAB',
    '&Psi;': '\u03A8',
    '&QUOT': '\u0022',
    '&QUOT;': '\u0022',
    '&Qfr;': '\uD835\uDD14',
    '&Qopf;': '\u211A',
    '&Qscr;': '\uD835\uDCAC',
    '&RBarr;': '\u2910',
    '&REG': '\u00AE',
    '&REG;': '\u00AE',
    '&Racute;': '\u0154',
    '&Rang;': '\u27EB',
    '&Rarr;': '\u21A0',
    '&Rarrtl;': '\u2916',
    '&Rcaron;': '\u0158',
    '&Rcedil;': '\u0156',
    '&Rcy;': '\u0420',
    '&Re;': '\u211C',
    '&ReverseElement;': '\u220B',
    '&ReverseEquilibrium;': '\u21CB',
    '&ReverseUpEquilibrium;': '\u296F',
    '&Rfr;': '\u211C',
    '&Rho;': '\u03A1',
    '&RightAngleBracket;': '\u27E9',
    '&RightArrow;': '\u2192',
    '&RightArrowBar;': '\u21E5',
    '&RightArrowLeftArrow;': '\u21C4',
    '&RightCeiling;': '\u2309',
    '&RightDoubleBracket;': '\u27E7',
    '&RightDownTeeVector;': '\u295D',
    '&RightDownVector;': '\u21C2',
    '&RightDownVectorBar;': '\u2955',
    '&RightFloor;': '\u230B',
    '&RightTee;': '\u22A2',
    '&RightTeeArrow;': '\u21A6',
    '&RightTeeVector;': '\u295B',
    '&RightTriangle;': '\u22B3',
    '&RightTriangleBar;': '\u29D0',
    '&RightTriangleEqual;': '\u22B5',
    '&RightUpDownVector;': '\u294F',
    '&RightUpTeeVector;': '\u295C',
    '&RightUpVector;': '\u21BE',
    '&RightUpVectorBar;': '\u2954',
    '&RightVector;': '\u21C0',
    '&RightVectorBar;': '\u2953',
    '&Rightarrow;': '\u21D2',
    '&Ropf;': '\u211D',
    '&RoundImplies;': '\u2970',
    '&Rrightarrow;': '\u21DB',
    '&Rscr;': '\u211B',
    '&Rsh;': '\u21B1',
    '&RuleDelayed;': '\u29F4',
    '&SHCHcy;': '\u0429',
    '&SHcy;': '\u0428',
    '&SOFTcy;': '\u042C',
    '&Sacute;': '\u015A',
    '&Sc;': '\u2ABC',
    '&Scaron;': '\u0160',
    '&Scedil;': '\u015E',
    '&Scirc;': '\u015C',
    '&Scy;': '\u0421',
    '&Sfr;': '\uD835\uDD16',
    '&ShortDownArrow;': '\u2193',
    '&ShortLeftArrow;': '\u2190',
    '&ShortRightArrow;': '\u2192',
    '&ShortUpArrow;': '\u2191',
    '&Sigma;': '\u03A3',
    '&SmallCircle;': '\u2218',
    '&Sopf;': '\uD835\uDD4A',
    '&Sqrt;': '\u221A',
    '&Square;': '\u25A1',
    '&SquareIntersection;': '\u2293',
    '&SquareSubset;': '\u228F',
    '&SquareSubsetEqual;': '\u2291',
    '&SquareSuperset;': '\u2290',
    '&SquareSupersetEqual;': '\u2292',
    '&SquareUnion;': '\u2294',
    '&Sscr;': '\uD835\uDCAE',
    '&Star;': '\u22C6',
    '&Sub;': '\u22D0',
    '&Subset;': '\u22D0',
    '&SubsetEqual;': '\u2286',
    '&Succeeds;': '\u227B',
    '&SucceedsEqual;': '\u2AB0',
    '&SucceedsSlantEqual;': '\u227D',
    '&SucceedsTilde;': '\u227F',
    '&SuchThat;': '\u220B',
    '&Sum;': '\u2211',
    '&Sup;': '\u22D1',
    '&Superset;': '\u2283',
    '&SupersetEqual;': '\u2287',
    '&Supset;': '\u22D1',
    '&THORN': '\u00DE',
    '&THORN;': '\u00DE',
    '&TRADE;': '\u2122',
    '&TSHcy;': '\u040B',
    '&TScy;': '\u0426',
    '&Tab;': '\u0009',
    '&Tau;': '\u03A4',
    '&Tcaron;': '\u0164',
    '&Tcedil;': '\u0162',
    '&Tcy;': '\u0422',
    '&Tfr;': '\uD835\uDD17',
    '&Therefore;': '\u2234',
    '&Theta;': '\u0398',
    '&ThickSpace;': '\u205F\u200A',
    '&ThinSpace;': '\u2009',
    '&Tilde;': '\u223C',
    '&TildeEqual;': '\u2243',
    '&TildeFullEqual;': '\u2245',
    '&TildeTilde;': '\u2248',
    '&Topf;': '\uD835\uDD4B',
    '&TripleDot;': '\u20DB',
    '&Tscr;': '\uD835\uDCAF',
    '&Tstrok;': '\u0166',
    '&Uacute': '\u00DA',
    '&Uacute;': '\u00DA',
    '&Uarr;': '\u219F',
    '&Uarrocir;': '\u2949',
    '&Ubrcy;': '\u040E',
    '&Ubreve;': '\u016C',
    '&Ucirc': '\u00DB',
    '&Ucirc;': '\u00DB',
    '&Ucy;': '\u0423',
    '&Udblac;': '\u0170',
    '&Ufr;': '\uD835\uDD18',
    '&Ugrave': '\u00D9',
    '&Ugrave;': '\u00D9',
    '&Umacr;': '\u016A',
    '&UnderBar;': '\u005F',
    '&UnderBrace;': '\u23DF',
    '&UnderBracket;': '\u23B5',
    '&UnderParenthesis;': '\u23DD',
    '&Union;': '\u22C3',
    '&UnionPlus;': '\u228E',
    '&Uogon;': '\u0172',
    '&Uopf;': '\uD835\uDD4C',
    '&UpArrow;': '\u2191',
    '&UpArrowBar;': '\u2912',
    '&UpArrowDownArrow;': '\u21C5',
    '&UpDownArrow;': '\u2195',
    '&UpEquilibrium;': '\u296E',
    '&UpTee;': '\u22A5',
    '&UpTeeArrow;': '\u21A5',
    '&Uparrow;': '\u21D1',
    '&Updownarrow;': '\u21D5',
    '&UpperLeftArrow;': '\u2196',
    '&UpperRightArrow;': '\u2197',
    '&Upsi;': '\u03D2',
    '&Upsilon;': '\u03A5',
    '&Uring;': '\u016E',
    '&Uscr;': '\uD835\uDCB0',
    '&Utilde;': '\u0168',
    '&Uuml': '\u00DC',
    '&Uuml;': '\u00DC',
    '&VDash;': '\u22AB',
    '&Vbar;': '\u2AEB',
    '&Vcy;': '\u0412',
    '&Vdash;': '\u22A9',
    '&Vdashl;': '\u2AE6',
    '&Vee;': '\u22C1',
    '&Verbar;': '\u2016',
    '&Vert;': '\u2016',
    '&VerticalBar;': '\u2223',
    '&VerticalLine;': '\u007C',
    '&VerticalSeparator;': '\u2758',
    '&VerticalTilde;': '\u2240',
    '&VeryThinSpace;': '\u200A',
    '&Vfr;': '\uD835\uDD19',
    '&Vopf;': '\uD835\uDD4D',
    '&Vscr;': '\uD835\uDCB1',
    '&Vvdash;': '\u22AA',
    '&Wcirc;': '\u0174',
    '&Wedge;': '\u22C0',
    '&Wfr;': '\uD835\uDD1A',
    '&Wopf;': '\uD835\uDD4E',
    '&Wscr;': '\uD835\uDCB2',
    '&Xfr;': '\uD835\uDD1B',
    '&Xi;': '\u039E',
    '&Xopf;': '\uD835\uDD4F',
    '&Xscr;': '\uD835\uDCB3',
    '&YAcy;': '\u042F',
    '&YIcy;': '\u0407',
    '&YUcy;': '\u042E',
    '&Yacute': '\u00DD',
    '&Yacute;': '\u00DD',
    '&Ycirc;': '\u0176',
    '&Ycy;': '\u042B',
    '&Yfr;': '\uD835\uDD1C',
    '&Yopf;': '\uD835\uDD50',
    '&Yscr;': '\uD835\uDCB4',
    '&Yuml;': '\u0178',
    '&ZHcy;': '\u0416',
    '&Zacute;': '\u0179',
    '&Zcaron;': '\u017D',
    '&Zcy;': '\u0417',
    '&Zdot;': '\u017B',
    '&ZeroWidthSpace;': '\u200B',
    '&Zeta;': '\u0396',
    '&Zfr;': '\u2128',
    '&Zopf;': '\u2124',
    '&Zscr;': '\uD835\uDCB5',
    '&aacute': '\u00E1',
    '&aacute;': '\u00E1',
    '&abreve;': '\u0103',
    '&ac;': '\u223E',
    '&acE;': '\u223E\u0333',
    '&acd;': '\u223F',
    '&acirc': '\u00E2',
    '&acirc;': '\u00E2',
    '&acute': '\u00B4',
    '&acute;': '\u00B4',
    '&acy;': '\u0430',
    '&aelig': '\u00E6',
    '&aelig;': '\u00E6',
    '&af;': '\u2061',
    '&afr;': '\uD835\uDD1E',
    '&agrave': '\u00E0',
    '&agrave;': '\u00E0',
    '&alefsym;': '\u2135',
    '&aleph;': '\u2135',
    '&alpha;': '\u03B1',
    '&amacr;': '\u0101',
    '&amalg;': '\u2A3F',
    '&amp': '\u0026',
    '&amp;': '\u0026',
    '&and;': '\u2227',
    '&andand;': '\u2A55',
    '&andd;': '\u2A5C',
    '&andslope;': '\u2A58',
    '&andv;': '\u2A5A',
    '&ang;': '\u2220',
    '&ange;': '\u29A4',
    '&angle;': '\u2220',
    '&angmsd;': '\u2221',
    '&angmsdaa;': '\u29A8',
    '&angmsdab;': '\u29A9',
    '&angmsdac;': '\u29AA',
    '&angmsdad;': '\u29AB',
    '&angmsdae;': '\u29AC',
    '&angmsdaf;': '\u29AD',
    '&angmsdag;': '\u29AE',
    '&angmsdah;': '\u29AF',
    '&angrt;': '\u221F',
    '&angrtvb;': '\u22BE',
    '&angrtvbd;': '\u299D',
    '&angsph;': '\u2222',
    '&angst;': '\u00C5',
    '&angzarr;': '\u237C',
    '&aogon;': '\u0105',
    '&aopf;': '\uD835\uDD52',
    '&ap;': '\u2248',
    '&apE;': '\u2A70',
    '&apacir;': '\u2A6F',
    '&ape;': '\u224A',
    '&apid;': '\u224B',
    '&apos;': '\u0027',
    '&approx;': '\u2248',
    '&approxeq;': '\u224A',
    '&aring': '\u00E5',
    '&aring;': '\u00E5',
    '&ascr;': '\uD835\uDCB6',
    '&ast;': '\u002A',
    '&asymp;': '\u2248',
    '&asympeq;': '\u224D',
    '&atilde': '\u00E3',
    '&atilde;': '\u00E3',
    '&auml': '\u00E4',
    '&auml;': '\u00E4',
    '&awconint;': '\u2233',
    '&awint;': '\u2A11',
    '&bNot;': '\u2AED',
    '&backcong;': '\u224C',
    '&backepsilon;': '\u03F6',
    '&backprime;': '\u2035',
    '&backsim;': '\u223D',
    '&backsimeq;': '\u22CD',
    '&barvee;': '\u22BD',
    '&barwed;': '\u2305',
    '&barwedge;': '\u2305',
    '&bbrk;': '\u23B5',
    '&bbrktbrk;': '\u23B6',
    '&bcong;': '\u224C',
    '&bcy;': '\u0431',
    '&bdquo;': '\u201E',
    '&becaus;': '\u2235',
    '&because;': '\u2235',
    '&bemptyv;': '\u29B0',
    '&bepsi;': '\u03F6',
    '&bernou;': '\u212C',
    '&beta;': '\u03B2',
    '&beth;': '\u2136',
    '&between;': '\u226C',
    '&bfr;': '\uD835\uDD1F',
    '&bigcap;': '\u22C2',
    '&bigcirc;': '\u25EF',
    '&bigcup;': '\u22C3',
    '&bigodot;': '\u2A00',
    '&bigoplus;': '\u2A01',
    '&bigotimes;': '\u2A02',
    '&bigsqcup;': '\u2A06',
    '&bigstar;': '\u2605',
    '&bigtriangledown;': '\u25BD',
    '&bigtriangleup;': '\u25B3',
    '&biguplus;': '\u2A04',
    '&bigvee;': '\u22C1',
    '&bigwedge;': '\u22C0',
    '&bkarow;': '\u290D',
    '&blacklozenge;': '\u29EB',
    '&blacksquare;': '\u25AA',
    '&blacktriangle;': '\u25B4',
    '&blacktriangledown;': '\u25BE',
    '&blacktriangleleft;': '\u25C2',
    '&blacktriangleright;': '\u25B8',
    '&blank;': '\u2423',
    '&blk12;': '\u2592',
    '&blk14;': '\u2591',
    '&blk34;': '\u2593',
    '&block;': '\u2588',
    '&bne;': '\u003D\u20E5',
    '&bnequiv;': '\u2261\u20E5',
    '&bnot;': '\u2310',
    '&bopf;': '\uD835\uDD53',
    '&bot;': '\u22A5',
    '&bottom;': '\u22A5',
    '&bowtie;': '\u22C8',
    '&boxDL;': '\u2557',
    '&boxDR;': '\u2554',
    '&boxDl;': '\u2556',
    '&boxDr;': '\u2553',
    '&boxH;': '\u2550',
    '&boxHD;': '\u2566',
    '&boxHU;': '\u2569',
    '&boxHd;': '\u2564',
    '&boxHu;': '\u2567',
    '&boxUL;': '\u255D',
    '&boxUR;': '\u255A',
    '&boxUl;': '\u255C',
    '&boxUr;': '\u2559',
    '&boxV;': '\u2551',
    '&boxVH;': '\u256C',
    '&boxVL;': '\u2563',
    '&boxVR;': '\u2560',
    '&boxVh;': '\u256B',
    '&boxVl;': '\u2562',
    '&boxVr;': '\u255F',
    '&boxbox;': '\u29C9',
    '&boxdL;': '\u2555',
    '&boxdR;': '\u2552',
    '&boxdl;': '\u2510',
    '&boxdr;': '\u250C',
    '&boxh;': '\u2500',
    '&boxhD;': '\u2565',
    '&boxhU;': '\u2568',
    '&boxhd;': '\u252C',
    '&boxhu;': '\u2534',
    '&boxminus;': '\u229F',
    '&boxplus;': '\u229E',
    '&boxtimes;': '\u22A0',
    '&boxuL;': '\u255B',
    '&boxuR;': '\u2558',
    '&boxul;': '\u2518',
    '&boxur;': '\u2514',
    '&boxv;': '\u2502',
    '&boxvH;': '\u256A',
    '&boxvL;': '\u2561',
    '&boxvR;': '\u255E',
    '&boxvh;': '\u253C',
    '&boxvl;': '\u2524',
    '&boxvr;': '\u251C',
    '&bprime;': '\u2035',
    '&breve;': '\u02D8',
    '&brvbar': '\u00A6',
    '&brvbar;': '\u00A6',
    '&bscr;': '\uD835\uDCB7',
    '&bsemi;': '\u204F',
    '&bsim;': '\u223D',
    '&bsime;': '\u22CD',
    '&bsol;': '\u005C',
    '&bsolb;': '\u29C5',
    '&bsolhsub;': '\u27C8',
    '&bull;': '\u2022',
    '&bullet;': '\u2022',
    '&bump;': '\u224E',
    '&bumpE;': '\u2AAE',
    '&bumpe;': '\u224F',
    '&bumpeq;': '\u224F',
    '&cacute;': '\u0107',
    '&cap;': '\u2229',
    '&capand;': '\u2A44',
    '&capbrcup;': '\u2A49',
    '&capcap;': '\u2A4B',
    '&capcup;': '\u2A47',
    '&capdot;': '\u2A40',
    '&caps;': '\u2229\uFE00',
    '&caret;': '\u2041',
    '&caron;': '\u02C7',
    '&ccaps;': '\u2A4D',
    '&ccaron;': '\u010D',
    '&ccedil': '\u00E7',
    '&ccedil;': '\u00E7',
    '&ccirc;': '\u0109',
    '&ccups;': '\u2A4C',
    '&ccupssm;': '\u2A50',
    '&cdot;': '\u010B',
    '&cedil': '\u00B8',
    '&cedil;': '\u00B8',
    '&cemptyv;': '\u29B2',
    '&cent': '\u00A2',
    '&cent;': '\u00A2',
    '&centerdot;': '\u00B7',
    '&cfr;': '\uD835\uDD20',
    '&chcy;': '\u0447',
    '&check;': '\u2713',
    '&checkmark;': '\u2713',
    '&chi;': '\u03C7',
    '&cir;': '\u25CB',
    '&cirE;': '\u29C3',
    '&circ;': '\u02C6',
    '&circeq;': '\u2257',
    '&circlearrowleft;': '\u21BA',
    '&circlearrowright;': '\u21BB',
    '&circledR;': '\u00AE',
    '&circledS;': '\u24C8',
    '&circledast;': '\u229B',
    '&circledcirc;': '\u229A',
    '&circleddash;': '\u229D',
    '&cire;': '\u2257',
    '&cirfnint;': '\u2A10',
    '&cirmid;': '\u2AEF',
    '&cirscir;': '\u29C2',
    '&clubs;': '\u2663',
    '&clubsuit;': '\u2663',
    '&colon;': '\u003A',
    '&colone;': '\u2254',
    '&coloneq;': '\u2254',
    '&comma;': '\u002C',
    '&commat;': '\u0040',
    '&comp;': '\u2201',
    '&compfn;': '\u2218',
    '&complement;': '\u2201',
    '&complexes;': '\u2102',
    '&cong;': '\u2245',
    '&congdot;': '\u2A6D',
    '&conint;': '\u222E',
    '&copf;': '\uD835\uDD54',
    '&coprod;': '\u2210',
    '&copy': '\u00A9',
    '&copy;': '\u00A9',
    '&copysr;': '\u2117',
    '&crarr;': '\u21B5',
    '&cross;': '\u2717',
    '&cscr;': '\uD835\uDCB8',
    '&csub;': '\u2ACF',
    '&csube;': '\u2AD1',
    '&csup;': '\u2AD0',
    '&csupe;': '\u2AD2',
    '&ctdot;': '\u22EF',
    '&cudarrl;': '\u2938',
    '&cudarrr;': '\u2935',
    '&cuepr;': '\u22DE',
    '&cuesc;': '\u22DF',
    '&cularr;': '\u21B6',
    '&cularrp;': '\u293D',
    '&cup;': '\u222A',
    '&cupbrcap;': '\u2A48',
    '&cupcap;': '\u2A46',
    '&cupcup;': '\u2A4A',
    '&cupdot;': '\u228D',
    '&cupor;': '\u2A45',
    '&cups;': '\u222A\uFE00',
    '&curarr;': '\u21B7',
    '&curarrm;': '\u293C',
    '&curlyeqprec;': '\u22DE',
    '&curlyeqsucc;': '\u22DF',
    '&curlyvee;': '\u22CE',
    '&curlywedge;': '\u22CF',
    '&curren': '\u00A4',
    '&curren;': '\u00A4',
    '&curvearrowleft;': '\u21B6',
    '&curvearrowright;': '\u21B7',
    '&cuvee;': '\u22CE',
    '&cuwed;': '\u22CF',
    '&cwconint;': '\u2232',
    '&cwint;': '\u2231',
    '&cylcty;': '\u232D',
    '&dArr;': '\u21D3',
    '&dHar;': '\u2965',
    '&dagger;': '\u2020',
    '&daleth;': '\u2138',
    '&darr;': '\u2193',
    '&dash;': '\u2010',
    '&dashv;': '\u22A3',
    '&dbkarow;': '\u290F',
    '&dblac;': '\u02DD',
    '&dcaron;': '\u010F',
    '&dcy;': '\u0434',
    '&dd;': '\u2146',
    '&ddagger;': '\u2021',
    '&ddarr;': '\u21CA',
    '&ddotseq;': '\u2A77',
    '&deg': '\u00B0',
    '&deg;': '\u00B0',
    '&delta;': '\u03B4',
    '&demptyv;': '\u29B1',
    '&dfisht;': '\u297F',
    '&dfr;': '\uD835\uDD21',
    '&dharl;': '\u21C3',
    '&dharr;': '\u21C2',
    '&diam;': '\u22C4',
    '&diamond;': '\u22C4',
    '&diamondsuit;': '\u2666',
    '&diams;': '\u2666',
    '&die;': '\u00A8',
    '&digamma;': '\u03DD',
    '&disin;': '\u22F2',
    '&div;': '\u00F7',
    '&divide': '\u00F7',
    '&divide;': '\u00F7',
    '&divideontimes;': '\u22C7',
    '&divonx;': '\u22C7',
    '&djcy;': '\u0452',
    '&dlcorn;': '\u231E',
    '&dlcrop;': '\u230D',
    '&dollar;': '\u0024',
    '&dopf;': '\uD835\uDD55',
    '&dot;': '\u02D9',
    '&doteq;': '\u2250',
    '&doteqdot;': '\u2251',
    '&dotminus;': '\u2238',
    '&dotplus;': '\u2214',
    '&dotsquare;': '\u22A1',
    '&doublebarwedge;': '\u2306',
    '&downarrow;': '\u2193',
    '&downdownarrows;': '\u21CA',
    '&downharpoonleft;': '\u21C3',
    '&downharpoonright;': '\u21C2',
    '&drbkarow;': '\u2910',
    '&drcorn;': '\u231F',
    '&drcrop;': '\u230C',
    '&dscr;': '\uD835\uDCB9',
    '&dscy;': '\u0455',
    '&dsol;': '\u29F6',
    '&dstrok;': '\u0111',
    '&dtdot;': '\u22F1',
    '&dtri;': '\u25BF',
    '&dtrif;': '\u25BE',
    '&duarr;': '\u21F5',
    '&duhar;': '\u296F',
    '&dwangle;': '\u29A6',
    '&dzcy;': '\u045F',
    '&dzigrarr;': '\u27FF',
    '&eDDot;': '\u2A77',
    '&eDot;': '\u2251',
    '&eacute': '\u00E9',
    '&eacute;': '\u00E9',
    '&easter;': '\u2A6E',
    '&ecaron;': '\u011B',
    '&ecir;': '\u2256',
    '&ecirc': '\u00EA',
    '&ecirc;': '\u00EA',
    '&ecolon;': '\u2255',
    '&ecy;': '\u044D',
    '&edot;': '\u0117',
    '&ee;': '\u2147',
    '&efDot;': '\u2252',
    '&efr;': '\uD835\uDD22',
    '&eg;': '\u2A9A',
    '&egrave': '\u00E8',
    '&egrave;': '\u00E8',
    '&egs;': '\u2A96',
    '&egsdot;': '\u2A98',
    '&el;': '\u2A99',
    '&elinters;': '\u23E7',
    '&ell;': '\u2113',
    '&els;': '\u2A95',
    '&elsdot;': '\u2A97',
    '&emacr;': '\u0113',
    '&empty;': '\u2205',
    '&emptyset;': '\u2205',
    '&emptyv;': '\u2205',
    '&emsp13;': '\u2004',
    '&emsp14;': '\u2005',
    '&emsp;': '\u2003',
    '&eng;': '\u014B',
    '&ensp;': '\u2002',
    '&eogon;': '\u0119',
    '&eopf;': '\uD835\uDD56',
    '&epar;': '\u22D5',
    '&eparsl;': '\u29E3',
    '&eplus;': '\u2A71',
    '&epsi;': '\u03B5',
    '&epsilon;': '\u03B5',
    '&epsiv;': '\u03F5',
    '&eqcirc;': '\u2256',
    '&eqcolon;': '\u2255',
    '&eqsim;': '\u2242',
    '&eqslantgtr;': '\u2A96',
    '&eqslantless;': '\u2A95',
    '&equals;': '\u003D',
    '&equest;': '\u225F',
    '&equiv;': '\u2261',
    '&equivDD;': '\u2A78',
    '&eqvparsl;': '\u29E5',
    '&erDot;': '\u2253',
    '&erarr;': '\u2971',
    '&escr;': '\u212F',
    '&esdot;': '\u2250',
    '&esim;': '\u2242',
    '&eta;': '\u03B7',
    '&eth': '\u00F0',
    '&eth;': '\u00F0',
    '&euml': '\u00EB',
    '&euml;': '\u00EB',
    '&euro;': '\u20AC',
    '&excl;': '\u0021',
    '&exist;': '\u2203',
    '&expectation;': '\u2130',
    '&exponentiale;': '\u2147',
    '&fallingdotseq;': '\u2252',
    '&fcy;': '\u0444',
    '&female;': '\u2640',
    '&ffilig;': '\uFB03',
    '&fflig;': '\uFB00',
    '&ffllig;': '\uFB04',
    '&ffr;': '\uD835\uDD23',
    '&filig;': '\uFB01',
    '&fjlig;': '\u0066\u006A',
    '&flat;': '\u266D',
    '&fllig;': '\uFB02',
    '&fltns;': '\u25B1',
    '&fnof;': '\u0192',
    '&fopf;': '\uD835\uDD57',
    '&forall;': '\u2200',
    '&fork;': '\u22D4',
    '&forkv;': '\u2AD9',
    '&fpartint;': '\u2A0D',
    '&frac12': '\u00BD',
    '&frac12;': '\u00BD',
    '&frac13;': '\u2153',
    '&frac14': '\u00BC',
    '&frac14;': '\u00BC',
    '&frac15;': '\u2155',
    '&frac16;': '\u2159',
    '&frac18;': '\u215B',
    '&frac23;': '\u2154',
    '&frac25;': '\u2156',
    '&frac34': '\u00BE',
    '&frac34;': '\u00BE',
    '&frac35;': '\u2157',
    '&frac38;': '\u215C',
    '&frac45;': '\u2158',
    '&frac56;': '\u215A',
    '&frac58;': '\u215D',
    '&frac78;': '\u215E',
    '&frasl;': '\u2044',
    '&frown;': '\u2322',
    '&fscr;': '\uD835\uDCBB',
    '&gE;': '\u2267',
    '&gEl;': '\u2A8C',
    '&gacute;': '\u01F5',
    '&gamma;': '\u03B3',
    '&gammad;': '\u03DD',
    '&gap;': '\u2A86',
    '&gbreve;': '\u011F',
    '&gcirc;': '\u011D',
    '&gcy;': '\u0433',
    '&gdot;': '\u0121',
    '&ge;': '\u2265',
    '&gel;': '\u22DB',
    '&geq;': '\u2265',
    '&geqq;': '\u2267',
    '&geqslant;': '\u2A7E',
    '&ges;': '\u2A7E',
    '&gescc;': '\u2AA9',
    '&gesdot;': '\u2A80',
    '&gesdoto;': '\u2A82',
    '&gesdotol;': '\u2A84',
    '&gesl;': '\u22DB\uFE00',
    '&gesles;': '\u2A94',
    '&gfr;': '\uD835\uDD24',
    '&gg;': '\u226B',
    '&ggg;': '\u22D9',
    '&gimel;': '\u2137',
    '&gjcy;': '\u0453',
    '&gl;': '\u2277',
    '&glE;': '\u2A92',
    '&gla;': '\u2AA5',
    '&glj;': '\u2AA4',
    '&gnE;': '\u2269',
    '&gnap;': '\u2A8A',
    '&gnapprox;': '\u2A8A',
    '&gne;': '\u2A88',
    '&gneq;': '\u2A88',
    '&gneqq;': '\u2269',
    '&gnsim;': '\u22E7',
    '&gopf;': '\uD835\uDD58',
    '&grave;': '\u0060',
    '&gscr;': '\u210A',
    '&gsim;': '\u2273',
    '&gsime;': '\u2A8E',
    '&gsiml;': '\u2A90',
    '&gt': '\u003E',
    '&gt;': '\u003E',
    '&gtcc;': '\u2AA7',
    '&gtcir;': '\u2A7A',
    '&gtdot;': '\u22D7',
    '&gtlPar;': '\u2995',
    '&gtquest;': '\u2A7C',
    '&gtrapprox;': '\u2A86',
    '&gtrarr;': '\u2978',
    '&gtrdot;': '\u22D7',
    '&gtreqless;': '\u22DB',
    '&gtreqqless;': '\u2A8C',
    '&gtrless;': '\u2277',
    '&gtrsim;': '\u2273',
    '&gvertneqq;': '\u2269\uFE00',
    '&gvnE;': '\u2269\uFE00',
    '&hArr;': '\u21D4',
    '&hairsp;': '\u200A',
    '&half;': '\u00BD',
    '&hamilt;': '\u210B',
    '&hardcy;': '\u044A',
    '&harr;': '\u2194',
    '&harrcir;': '\u2948',
    '&harrw;': '\u21AD',
    '&hbar;': '\u210F',
    '&hcirc;': '\u0125',
    '&hearts;': '\u2665',
    '&heartsuit;': '\u2665',
    '&hellip;': '\u2026',
    '&hercon;': '\u22B9',
    '&hfr;': '\uD835\uDD25',
    '&hksearow;': '\u2925',
    '&hkswarow;': '\u2926',
    '&hoarr;': '\u21FF',
    '&homtht;': '\u223B',
    '&hookleftarrow;': '\u21A9',
    '&hookrightarrow;': '\u21AA',
    '&hopf;': '\uD835\uDD59',
    '&horbar;': '\u2015',
    '&hscr;': '\uD835\uDCBD',
    '&hslash;': '\u210F',
    '&hstrok;': '\u0127',
    '&hybull;': '\u2043',
    '&hyphen;': '\u2010',
    '&iacute': '\u00ED',
    '&iacute;': '\u00ED',
    '&ic;': '\u2063',
    '&icirc': '\u00EE',
    '&icirc;': '\u00EE',
    '&icy;': '\u0438',
    '&iecy;': '\u0435',
    '&iexcl': '\u00A1',
    '&iexcl;': '\u00A1',
    '&iff;': '\u21D4',
    '&ifr;': '\uD835\uDD26',
    '&igrave': '\u00EC',
    '&igrave;': '\u00EC',
    '&ii;': '\u2148',
    '&iiiint;': '\u2A0C',
    '&iiint;': '\u222D',
    '&iinfin;': '\u29DC',
    '&iiota;': '\u2129',
    '&ijlig;': '\u0133',
    '&imacr;': '\u012B',
    '&image;': '\u2111',
    '&imagline;': '\u2110',
    '&imagpart;': '\u2111',
    '&imath;': '\u0131',
    '&imof;': '\u22B7',
    '&imped;': '\u01B5',
    '&in;': '\u2208',
    '&incare;': '\u2105',
    '&infin;': '\u221E',
    '&infintie;': '\u29DD',
    '&inodot;': '\u0131',
    '&int;': '\u222B',
    '&intcal;': '\u22BA',
    '&integers;': '\u2124',
    '&intercal;': '\u22BA',
    '&intlarhk;': '\u2A17',
    '&intprod;': '\u2A3C',
    '&iocy;': '\u0451',
    '&iogon;': '\u012F',
    '&iopf;': '\uD835\uDD5A',
    '&iota;': '\u03B9',
    '&iprod;': '\u2A3C',
    '&iquest': '\u00BF',
    '&iquest;': '\u00BF',
    '&iscr;': '\uD835\uDCBE',
    '&isin;': '\u2208',
    '&isinE;': '\u22F9',
    '&isindot;': '\u22F5',
    '&isins;': '\u22F4',
    '&isinsv;': '\u22F3',
    '&isinv;': '\u2208',
    '&it;': '\u2062',
    '&itilde;': '\u0129',
    '&iukcy;': '\u0456',
    '&iuml': '\u00EF',
    '&iuml;': '\u00EF',
    '&jcirc;': '\u0135',
    '&jcy;': '\u0439',
    '&jfr;': '\uD835\uDD27',
    '&jmath;': '\u0237',
    '&jopf;': '\uD835\uDD5B',
    '&jscr;': '\uD835\uDCBF',
    '&jsercy;': '\u0458',
    '&jukcy;': '\u0454',
    '&kappa;': '\u03BA',
    '&kappav;': '\u03F0',
    '&kcedil;': '\u0137',
    '&kcy;': '\u043A',
    '&kfr;': '\uD835\uDD28',
    '&kgreen;': '\u0138',
    '&khcy;': '\u0445',
    '&kjcy;': '\u045C',
    '&kopf;': '\uD835\uDD5C',
    '&kscr;': '\uD835\uDCC0',
    '&lAarr;': '\u21DA',
    '&lArr;': '\u21D0',
    '&lAtail;': '\u291B',
    '&lBarr;': '\u290E',
    '&lE;': '\u2266',
    '&lEg;': '\u2A8B',
    '&lHar;': '\u2962',
    '&lacute;': '\u013A',
    '&laemptyv;': '\u29B4',
    '&lagran;': '\u2112',
    '&lambda;': '\u03BB',
    '&lang;': '\u27E8',
    '&langd;': '\u2991',
    '&langle;': '\u27E8',
    '&lap;': '\u2A85',
    '&laquo': '\u00AB',
    '&laquo;': '\u00AB',
    '&larr;': '\u2190',
    '&larrb;': '\u21E4',
    '&larrbfs;': '\u291F',
    '&larrfs;': '\u291D',
    '&larrhk;': '\u21A9',
    '&larrlp;': '\u21AB',
    '&larrpl;': '\u2939',
    '&larrsim;': '\u2973',
    '&larrtl;': '\u21A2',
    '&lat;': '\u2AAB',
    '&latail;': '\u2919',
    '&late;': '\u2AAD',
    '&lates;': '\u2AAD\uFE00',
    '&lbarr;': '\u290C',
    '&lbbrk;': '\u2772',
    '&lbrace;': '\u007B',
    '&lbrack;': '\u005B',
    '&lbrke;': '\u298B',
    '&lbrksld;': '\u298F',
    '&lbrkslu;': '\u298D',
    '&lcaron;': '\u013E',
    '&lcedil;': '\u013C',
    '&lceil;': '\u2308',
    '&lcub;': '\u007B',
    '&lcy;': '\u043B',
    '&ldca;': '\u2936',
    '&ldquo;': '\u201C',
    '&ldquor;': '\u201E',
    '&ldrdhar;': '\u2967',
    '&ldrushar;': '\u294B',
    '&ldsh;': '\u21B2',
    '&le;': '\u2264',
    '&leftarrow;': '\u2190',
    '&leftarrowtail;': '\u21A2',
    '&leftharpoondown;': '\u21BD',
    '&leftharpoonup;': '\u21BC',
    '&leftleftarrows;': '\u21C7',
    '&leftrightarrow;': '\u2194',
    '&leftrightarrows;': '\u21C6',
    '&leftrightharpoons;': '\u21CB',
    '&leftrightsquigarrow;': '\u21AD',
    '&leftthreetimes;': '\u22CB',
    '&leg;': '\u22DA',
    '&leq;': '\u2264',
    '&leqq;': '\u2266',
    '&leqslant;': '\u2A7D',
    '&les;': '\u2A7D',
    '&lescc;': '\u2AA8',
    '&lesdot;': '\u2A7F',
    '&lesdoto;': '\u2A81',
    '&lesdotor;': '\u2A83',
    '&lesg;': '\u22DA\uFE00',
    '&lesges;': '\u2A93',
    '&lessapprox;': '\u2A85',
    '&lessdot;': '\u22D6',
    '&lesseqgtr;': '\u22DA',
    '&lesseqqgtr;': '\u2A8B',
    '&lessgtr;': '\u2276',
    '&lesssim;': '\u2272',
    '&lfisht;': '\u297C',
    '&lfloor;': '\u230A',
    '&lfr;': '\uD835\uDD29',
    '&lg;': '\u2276',
    '&lgE;': '\u2A91',
    '&lhard;': '\u21BD',
    '&lharu;': '\u21BC',
    '&lharul;': '\u296A',
    '&lhblk;': '\u2584',
    '&ljcy;': '\u0459',
    '&ll;': '\u226A',
    '&llarr;': '\u21C7',
    '&llcorner;': '\u231E',
    '&llhard;': '\u296B',
    '&lltri;': '\u25FA',
    '&lmidot;': '\u0140',
    '&lmoust;': '\u23B0',
    '&lmoustache;': '\u23B0',
    '&lnE;': '\u2268',
    '&lnap;': '\u2A89',
    '&lnapprox;': '\u2A89',
    '&lne;': '\u2A87',
    '&lneq;': '\u2A87',
    '&lneqq;': '\u2268',
    '&lnsim;': '\u22E6',
    '&loang;': '\u27EC',
    '&loarr;': '\u21FD',
    '&lobrk;': '\u27E6',
    '&longleftarrow;': '\u27F5',
    '&longleftrightarrow;': '\u27F7',
    '&longmapsto;': '\u27FC',
    '&longrightarrow;': '\u27F6',
    '&looparrowleft;': '\u21AB',
    '&looparrowright;': '\u21AC',
    '&lopar;': '\u2985',
    '&lopf;': '\uD835\uDD5D',
    '&loplus;': '\u2A2D',
    '&lotimes;': '\u2A34',
    '&lowast;': '\u2217',
    '&lowbar;': '\u005F',
    '&loz;': '\u25CA',
    '&lozenge;': '\u25CA',
    '&lozf;': '\u29EB',
    '&lpar;': '\u0028',
    '&lparlt;': '\u2993',
    '&lrarr;': '\u21C6',
    '&lrcorner;': '\u231F',
    '&lrhar;': '\u21CB',
    '&lrhard;': '\u296D',
    '&lrm;': '\u200E',
    '&lrtri;': '\u22BF',
    '&lsaquo;': '\u2039',
    '&lscr;': '\uD835\uDCC1',
    '&lsh;': '\u21B0',
    '&lsim;': '\u2272',
    '&lsime;': '\u2A8D',
    '&lsimg;': '\u2A8F',
    '&lsqb;': '\u005B',
    '&lsquo;': '\u2018',
    '&lsquor;': '\u201A',
    '&lstrok;': '\u0142',
    '&lt': '\u003C',
    '&lt;': '\u003C',
    '&ltcc;': '\u2AA6',
    '&ltcir;': '\u2A79',
    '&ltdot;': '\u22D6',
    '&lthree;': '\u22CB',
    '&ltimes;': '\u22C9',
    '&ltlarr;': '\u2976',
    '&ltquest;': '\u2A7B',
    '&ltrPar;': '\u2996',
    '&ltri;': '\u25C3',
    '&ltrie;': '\u22B4',
    '&ltrif;': '\u25C2',
    '&lurdshar;': '\u294A',
    '&luruhar;': '\u2966',
    '&lvertneqq;': '\u2268\uFE00',
    '&lvnE;': '\u2268\uFE00',
    '&mDDot;': '\u223A',
    '&macr': '\u00AF',
    '&macr;': '\u00AF',
    '&male;': '\u2642',
    '&malt;': '\u2720',
    '&maltese;': '\u2720',
    '&map;': '\u21A6',
    '&mapsto;': '\u21A6',
    '&mapstodown;': '\u21A7',
    '&mapstoleft;': '\u21A4',
    '&mapstoup;': '\u21A5',
    '&marker;': '\u25AE',
    '&mcomma;': '\u2A29',
    '&mcy;': '\u043C',
    '&mdash;': '\u2014',
    '&measuredangle;': '\u2221',
    '&mfr;': '\uD835\uDD2A',
    '&mho;': '\u2127',
    '&micro': '\u00B5',
    '&micro;': '\u00B5',
    '&mid;': '\u2223',
    '&midast;': '\u002A',
    '&midcir;': '\u2AF0',
    '&middot': '\u00B7',
    '&middot;': '\u00B7',
    '&minus;': '\u2212',
    '&minusb;': '\u229F',
    '&minusd;': '\u2238',
    '&minusdu;': '\u2A2A',
    '&mlcp;': '\u2ADB',
    '&mldr;': '\u2026',
    '&mnplus;': '\u2213',
    '&models;': '\u22A7',
    '&mopf;': '\uD835\uDD5E',
    '&mp;': '\u2213',
    '&mscr;': '\uD835\uDCC2',
    '&mstpos;': '\u223E',
    '&mu;': '\u03BC',
    '&multimap;': '\u22B8',
    '&mumap;': '\u22B8',
    '&nGg;': '\u22D9\u0338',
    '&nGt;': '\u226B\u20D2',
    '&nGtv;': '\u226B\u0338',
    '&nLeftarrow;': '\u21CD',
    '&nLeftrightarrow;': '\u21CE',
    '&nLl;': '\u22D8\u0338',
    '&nLt;': '\u226A\u20D2',
    '&nLtv;': '\u226A\u0338',
    '&nRightarrow;': '\u21CF',
    '&nVDash;': '\u22AF',
    '&nVdash;': '\u22AE',
    '&nabla;': '\u2207',
    '&nacute;': '\u0144',
    '&nang;': '\u2220\u20D2',
    '&nap;': '\u2249',
    '&napE;': '\u2A70\u0338',
    '&napid;': '\u224B\u0338',
    '&napos;': '\u0149',
    '&napprox;': '\u2249',
    '&natur;': '\u266E',
    '&natural;': '\u266E',
    '&naturals;': '\u2115',
    '&nbsp': '\u00A0',
    '&nbsp;': '\u00A0',
    '&nbump;': '\u224E\u0338',
    '&nbumpe;': '\u224F\u0338',
    '&ncap;': '\u2A43',
    '&ncaron;': '\u0148',
    '&ncedil;': '\u0146',
    '&ncong;': '\u2247',
    '&ncongdot;': '\u2A6D\u0338',
    '&ncup;': '\u2A42',
    '&ncy;': '\u043D',
    '&ndash;': '\u2013',
    '&ne;': '\u2260',
    '&neArr;': '\u21D7',
    '&nearhk;': '\u2924',
    '&nearr;': '\u2197',
    '&nearrow;': '\u2197',
    '&nedot;': '\u2250\u0338',
    '&nequiv;': '\u2262',
    '&nesear;': '\u2928',
    '&nesim;': '\u2242\u0338',
    '&nexist;': '\u2204',
    '&nexists;': '\u2204',
    '&nfr;': '\uD835\uDD2B',
    '&ngE;': '\u2267\u0338',
    '&nge;': '\u2271',
    '&ngeq;': '\u2271',
    '&ngeqq;': '\u2267\u0338',
    '&ngeqslant;': '\u2A7E\u0338',
    '&nges;': '\u2A7E\u0338',
    '&ngsim;': '\u2275',
    '&ngt;': '\u226F',
    '&ngtr;': '\u226F',
    '&nhArr;': '\u21CE',
    '&nharr;': '\u21AE',
    '&nhpar;': '\u2AF2',
    '&ni;': '\u220B',
    '&nis;': '\u22FC',
    '&nisd;': '\u22FA',
    '&niv;': '\u220B',
    '&njcy;': '\u045A',
    '&nlArr;': '\u21CD',
    '&nlE;': '\u2266\u0338',
    '&nlarr;': '\u219A',
    '&nldr;': '\u2025',
    '&nle;': '\u2270',
    '&nleftarrow;': '\u219A',
    '&nleftrightarrow;': '\u21AE',
    '&nleq;': '\u2270',
    '&nleqq;': '\u2266\u0338',
    '&nleqslant;': '\u2A7D\u0338',
    '&nles;': '\u2A7D\u0338',
    '&nless;': '\u226E',
    '&nlsim;': '\u2274',
    '&nlt;': '\u226E',
    '&nltri;': '\u22EA',
    '&nltrie;': '\u22EC',
    '&nmid;': '\u2224',
    '&nopf;': '\uD835\uDD5F',
    '&not': '\u00AC',
    '&not;': '\u00AC',
    '&notin;': '\u2209',
    '&notinE;': '\u22F9\u0338',
    '&notindot;': '\u22F5\u0338',
    '&notinva;': '\u2209',
    '&notinvb;': '\u22F7',
    '&notinvc;': '\u22F6',
    '&notni;': '\u220C',
    '&notniva;': '\u220C',
    '&notnivb;': '\u22FE',
    '&notnivc;': '\u22FD',
    '&npar;': '\u2226',
    '&nparallel;': '\u2226',
    '&nparsl;': '\u2AFD\u20E5',
    '&npart;': '\u2202\u0338',
    '&npolint;': '\u2A14',
    '&npr;': '\u2280',
    '&nprcue;': '\u22E0',
    '&npre;': '\u2AAF\u0338',
    '&nprec;': '\u2280',
    '&npreceq;': '\u2AAF\u0338',
    '&nrArr;': '\u21CF',
    '&nrarr;': '\u219B',
    '&nrarrc;': '\u2933\u0338',
    '&nrarrw;': '\u219D\u0338',
    '&nrightarrow;': '\u219B',
    '&nrtri;': '\u22EB',
    '&nrtrie;': '\u22ED',
    '&nsc;': '\u2281',
    '&nsccue;': '\u22E1',
    '&nsce;': '\u2AB0\u0338',
    '&nscr;': '\uD835\uDCC3',
    '&nshortmid;': '\u2224',
    '&nshortparallel;': '\u2226',
    '&nsim;': '\u2241',
    '&nsime;': '\u2244',
    '&nsimeq;': '\u2244',
    '&nsmid;': '\u2224',
    '&nspar;': '\u2226',
    '&nsqsube;': '\u22E2',
    '&nsqsupe;': '\u22E3',
    '&nsub;': '\u2284',
    '&nsubE;': '\u2AC5\u0338',
    '&nsube;': '\u2288',
    '&nsubset;': '\u2282\u20D2',
    '&nsubseteq;': '\u2288',
    '&nsubseteqq;': '\u2AC5\u0338',
    '&nsucc;': '\u2281',
    '&nsucceq;': '\u2AB0\u0338',
    '&nsup;': '\u2285',
    '&nsupE;': '\u2AC6\u0338',
    '&nsupe;': '\u2289',
    '&nsupset;': '\u2283\u20D2',
    '&nsupseteq;': '\u2289',
    '&nsupseteqq;': '\u2AC6\u0338',
    '&ntgl;': '\u2279',
    '&ntilde': '\u00F1',
    '&ntilde;': '\u00F1',
    '&ntlg;': '\u2278',
    '&ntriangleleft;': '\u22EA',
    '&ntrianglelefteq;': '\u22EC',
    '&ntriangleright;': '\u22EB',
    '&ntrianglerighteq;': '\u22ED',
    '&nu;': '\u03BD',
    '&num;': '\u0023',
    '&numero;': '\u2116',
    '&numsp;': '\u2007',
    '&nvDash;': '\u22AD',
    '&nvHarr;': '\u2904',
    '&nvap;': '\u224D\u20D2',
    '&nvdash;': '\u22AC',
    '&nvge;': '\u2265\u20D2',
    '&nvgt;': '\u003E\u20D2',
    '&nvinfin;': '\u29DE',
    '&nvlArr;': '\u2902',
    '&nvle;': '\u2264\u20D2',
    '&nvlt;': '\u003C\u20D2',
    '&nvltrie;': '\u22B4\u20D2',
    '&nvrArr;': '\u2903',
    '&nvrtrie;': '\u22B5\u20D2',
    '&nvsim;': '\u223C\u20D2',
    '&nwArr;': '\u21D6',
    '&nwarhk;': '\u2923',
    '&nwarr;': '\u2196',
    '&nwarrow;': '\u2196',
    '&nwnear;': '\u2927',
    '&oS;': '\u24C8',
    '&oacute': '\u00F3',
    '&oacute;': '\u00F3',
    '&oast;': '\u229B',
    '&ocir;': '\u229A',
    '&ocirc': '\u00F4',
    '&ocirc;': '\u00F4',
    '&ocy;': '\u043E',
    '&odash;': '\u229D',
    '&odblac;': '\u0151',
    '&odiv;': '\u2A38',
    '&odot;': '\u2299',
    '&odsold;': '\u29BC',
    '&oelig;': '\u0153',
    '&ofcir;': '\u29BF',
    '&ofr;': '\uD835\uDD2C',
    '&ogon;': '\u02DB',
    '&ograve': '\u00F2',
    '&ograve;': '\u00F2',
    '&ogt;': '\u29C1',
    '&ohbar;': '\u29B5',
    '&ohm;': '\u03A9',
    '&oint;': '\u222E',
    '&olarr;': '\u21BA',
    '&olcir;': '\u29BE',
    '&olcross;': '\u29BB',
    '&oline;': '\u203E',
    '&olt;': '\u29C0',
    '&omacr;': '\u014D',
    '&omega;': '\u03C9',
    '&omicron;': '\u03BF',
    '&omid;': '\u29B6',
    '&ominus;': '\u2296',
    '&oopf;': '\uD835\uDD60',
    '&opar;': '\u29B7',
    '&operp;': '\u29B9',
    '&oplus;': '\u2295',
    '&or;': '\u2228',
    '&orarr;': '\u21BB',
    '&ord;': '\u2A5D',
    '&order;': '\u2134',
    '&orderof;': '\u2134',
    '&ordf': '\u00AA',
    '&ordf;': '\u00AA',
    '&ordm': '\u00BA',
    '&ordm;': '\u00BA',
    '&origof;': '\u22B6',
    '&oror;': '\u2A56',
    '&orslope;': '\u2A57',
    '&orv;': '\u2A5B',
    '&oscr;': '\u2134',
    '&oslash': '\u00F8',
    '&oslash;': '\u00F8',
    '&osol;': '\u2298',
    '&otilde': '\u00F5',
    '&otilde;': '\u00F5',
    '&otimes;': '\u2297',
    '&otimesas;': '\u2A36',
    '&ouml': '\u00F6',
    '&ouml;': '\u00F6',
    '&ovbar;': '\u233D',
    '&par;': '\u2225',
    '&para': '\u00B6',
    '&para;': '\u00B6',
    '&parallel;': '\u2225',
    '&parsim;': '\u2AF3',
    '&parsl;': '\u2AFD',
    '&part;': '\u2202',
    '&pcy;': '\u043F',
    '&percnt;': '\u0025',
    '&period;': '\u002E',
    '&permil;': '\u2030',
    '&perp;': '\u22A5',
    '&pertenk;': '\u2031',
    '&pfr;': '\uD835\uDD2D',
    '&phi;': '\u03C6',
    '&phiv;': '\u03D5',
    '&phmmat;': '\u2133',
    '&phone;': '\u260E',
    '&pi;': '\u03C0',
    '&pitchfork;': '\u22D4',
    '&piv;': '\u03D6',
    '&planck;': '\u210F',
    '&planckh;': '\u210E',
    '&plankv;': '\u210F',
    '&plus;': '\u002B',
    '&plusacir;': '\u2A23',
    '&plusb;': '\u229E',
    '&pluscir;': '\u2A22',
    '&plusdo;': '\u2214',
    '&plusdu;': '\u2A25',
    '&pluse;': '\u2A72',
    '&plusmn': '\u00B1',
    '&plusmn;': '\u00B1',
    '&plussim;': '\u2A26',
    '&plustwo;': '\u2A27',
    '&pm;': '\u00B1',
    '&pointint;': '\u2A15',
    '&popf;': '\uD835\uDD61',
    '&pound': '\u00A3',
    '&pound;': '\u00A3',
    '&pr;': '\u227A',
    '&prE;': '\u2AB3',
    '&prap;': '\u2AB7',
    '&prcue;': '\u227C',
    '&pre;': '\u2AAF',
    '&prec;': '\u227A',
    '&precapprox;': '\u2AB7',
    '&preccurlyeq;': '\u227C',
    '&preceq;': '\u2AAF',
    '&precnapprox;': '\u2AB9',
    '&precneqq;': '\u2AB5',
    '&precnsim;': '\u22E8',
    '&precsim;': '\u227E',
    '&prime;': '\u2032',
    '&primes;': '\u2119',
    '&prnE;': '\u2AB5',
    '&prnap;': '\u2AB9',
    '&prnsim;': '\u22E8',
    '&prod;': '\u220F',
    '&profalar;': '\u232E',
    '&profline;': '\u2312',
    '&profsurf;': '\u2313',
    '&prop;': '\u221D',
    '&propto;': '\u221D',
    '&prsim;': '\u227E',
    '&prurel;': '\u22B0',
    '&pscr;': '\uD835\uDCC5',
    '&psi;': '\u03C8',
    '&puncsp;': '\u2008',
    '&qfr;': '\uD835\uDD2E',
    '&qint;': '\u2A0C',
    '&qopf;': '\uD835\uDD62',
    '&qprime;': '\u2057',
    '&qscr;': '\uD835\uDCC6',
    '&quaternions;': '\u210D',
    '&quatint;': '\u2A16',
    '&quest;': '\u003F',
    '&questeq;': '\u225F',
    '&quot': '\u0022',
    '&quot;': '\u0022',
    '&rAarr;': '\u21DB',
    '&rArr;': '\u21D2',
    '&rAtail;': '\u291C',
    '&rBarr;': '\u290F',
    '&rHar;': '\u2964',
    '&race;': '\u223D\u0331',
    '&racute;': '\u0155',
    '&radic;': '\u221A',
    '&raemptyv;': '\u29B3',
    '&rang;': '\u27E9',
    '&rangd;': '\u2992',
    '&range;': '\u29A5',
    '&rangle;': '\u27E9',
    '&raquo': '\u00BB',
    '&raquo;': '\u00BB',
    '&rarr;': '\u2192',
    '&rarrap;': '\u2975',
    '&rarrb;': '\u21E5',
    '&rarrbfs;': '\u2920',
    '&rarrc;': '\u2933',
    '&rarrfs;': '\u291E',
    '&rarrhk;': '\u21AA',
    '&rarrlp;': '\u21AC',
    '&rarrpl;': '\u2945',
    '&rarrsim;': '\u2974',
    '&rarrtl;': '\u21A3',
    '&rarrw;': '\u219D',
    '&ratail;': '\u291A',
    '&ratio;': '\u2236',
    '&rationals;': '\u211A',
    '&rbarr;': '\u290D',
    '&rbbrk;': '\u2773',
    '&rbrace;': '\u007D',
    '&rbrack;': '\u005D',
    '&rbrke;': '\u298C',
    '&rbrksld;': '\u298E',
    '&rbrkslu;': '\u2990',
    '&rcaron;': '\u0159',
    '&rcedil;': '\u0157',
    '&rceil;': '\u2309',
    '&rcub;': '\u007D',
    '&rcy;': '\u0440',
    '&rdca;': '\u2937',
    '&rdldhar;': '\u2969',
    '&rdquo;': '\u201D',
    '&rdquor;': '\u201D',
    '&rdsh;': '\u21B3',
    '&real;': '\u211C',
    '&realine;': '\u211B',
    '&realpart;': '\u211C',
    '&reals;': '\u211D',
    '&rect;': '\u25AD',
    '&reg': '\u00AE',
    '&reg;': '\u00AE',
    '&rfisht;': '\u297D',
    '&rfloor;': '\u230B',
    '&rfr;': '\uD835\uDD2F',
    '&rhard;': '\u21C1',
    '&rharu;': '\u21C0',
    '&rharul;': '\u296C',
    '&rho;': '\u03C1',
    '&rhov;': '\u03F1',
    '&rightarrow;': '\u2192',
    '&rightarrowtail;': '\u21A3',
    '&rightharpoondown;': '\u21C1',
    '&rightharpoonup;': '\u21C0',
    '&rightleftarrows;': '\u21C4',
    '&rightleftharpoons;': '\u21CC',
    '&rightrightarrows;': '\u21C9',
    '&rightsquigarrow;': '\u219D',
    '&rightthreetimes;': '\u22CC',
    '&ring;': '\u02DA',
    '&risingdotseq;': '\u2253',
    '&rlarr;': '\u21C4',
    '&rlhar;': '\u21CC',
    '&rlm;': '\u200F',
    '&rmoust;': '\u23B1',
    '&rmoustache;': '\u23B1',
    '&rnmid;': '\u2AEE',
    '&roang;': '\u27ED',
    '&roarr;': '\u21FE',
    '&robrk;': '\u27E7',
    '&ropar;': '\u2986',
    '&ropf;': '\uD835\uDD63',
    '&roplus;': '\u2A2E',
    '&rotimes;': '\u2A35',
    '&rpar;': '\u0029',
    '&rpargt;': '\u2994',
    '&rppolint;': '\u2A12',
    '&rrarr;': '\u21C9',
    '&rsaquo;': '\u203A',
    '&rscr;': '\uD835\uDCC7',
    '&rsh;': '\u21B1',
    '&rsqb;': '\u005D',
    '&rsquo;': '\u2019',
    '&rsquor;': '\u2019',
    '&rthree;': '\u22CC',
    '&rtimes;': '\u22CA',
    '&rtri;': '\u25B9',
    '&rtrie;': '\u22B5',
    '&rtrif;': '\u25B8',
    '&rtriltri;': '\u29CE',
    '&ruluhar;': '\u2968',
    '&rx;': '\u211E',
    '&sacute;': '\u015B',
    '&sbquo;': '\u201A',
    '&sc;': '\u227B',
    '&scE;': '\u2AB4',
    '&scap;': '\u2AB8',
    '&scaron;': '\u0161',
    '&sccue;': '\u227D',
    '&sce;': '\u2AB0',
    '&scedil;': '\u015F',
    '&scirc;': '\u015D',
    '&scnE;': '\u2AB6',
    '&scnap;': '\u2ABA',
    '&scnsim;': '\u22E9',
    '&scpolint;': '\u2A13',
    '&scsim;': '\u227F',
    '&scy;': '\u0441',
    '&sdot;': '\u22C5',
    '&sdotb;': '\u22A1',
    '&sdote;': '\u2A66',
    '&seArr;': '\u21D8',
    '&searhk;': '\u2925',
    '&searr;': '\u2198',
    '&searrow;': '\u2198',
    '&sect': '\u00A7',
    '&sect;': '\u00A7',
    '&semi;': '\u003B',
    '&seswar;': '\u2929',
    '&setminus;': '\u2216',
    '&setmn;': '\u2216',
    '&sext;': '\u2736',
    '&sfr;': '\uD835\uDD30',
    '&sfrown;': '\u2322',
    '&sharp;': '\u266F',
    '&shchcy;': '\u0449',
    '&shcy;': '\u0448',
    '&shortmid;': '\u2223',
    '&shortparallel;': '\u2225',
    '&shy': '\u00AD',
    '&shy;': '\u00AD',
    '&sigma;': '\u03C3',
    '&sigmaf;': '\u03C2',
    '&sigmav;': '\u03C2',
    '&sim;': '\u223C',
    '&simdot;': '\u2A6A',
    '&sime;': '\u2243',
    '&simeq;': '\u2243',
    '&simg;': '\u2A9E',
    '&simgE;': '\u2AA0',
    '&siml;': '\u2A9D',
    '&simlE;': '\u2A9F',
    '&simne;': '\u2246',
    '&simplus;': '\u2A24',
    '&simrarr;': '\u2972',
    '&slarr;': '\u2190',
    '&smallsetminus;': '\u2216',
    '&smashp;': '\u2A33',
    '&smeparsl;': '\u29E4',
    '&smid;': '\u2223',
    '&smile;': '\u2323',
    '&smt;': '\u2AAA',
    '&smte;': '\u2AAC',
    '&smtes;': '\u2AAC\uFE00',
    '&softcy;': '\u044C',
    '&sol;': '\u002F',
    '&solb;': '\u29C4',
    '&solbar;': '\u233F',
    '&sopf;': '\uD835\uDD64',
    '&spades;': '\u2660',
    '&spadesuit;': '\u2660',
    '&spar;': '\u2225',
    '&sqcap;': '\u2293',
    '&sqcaps;': '\u2293\uFE00',
    '&sqcup;': '\u2294',
    '&sqcups;': '\u2294\uFE00',
    '&sqsub;': '\u228F',
    '&sqsube;': '\u2291',
    '&sqsubset;': '\u228F',
    '&sqsubseteq;': '\u2291',
    '&sqsup;': '\u2290',
    '&sqsupe;': '\u2292',
    '&sqsupset;': '\u2290',
    '&sqsupseteq;': '\u2292',
    '&squ;': '\u25A1',
    '&square;': '\u25A1',
    '&squarf;': '\u25AA',
    '&squf;': '\u25AA',
    '&srarr;': '\u2192',
    '&sscr;': '\uD835\uDCC8',
    '&ssetmn;': '\u2216',
    '&ssmile;': '\u2323',
    '&sstarf;': '\u22C6',
    '&star;': '\u2606',
    '&starf;': '\u2605',
    '&straightepsilon;': '\u03F5',
    '&straightphi;': '\u03D5',
    '&strns;': '\u00AF',
    '&sub;': '\u2282',
    '&subE;': '\u2AC5',
    '&subdot;': '\u2ABD',
    '&sube;': '\u2286',
    '&subedot;': '\u2AC3',
    '&submult;': '\u2AC1',
    '&subnE;': '\u2ACB',
    '&subne;': '\u228A',
    '&subplus;': '\u2ABF',
    '&subrarr;': '\u2979',
    '&subset;': '\u2282',
    '&subseteq;': '\u2286',
    '&subseteqq;': '\u2AC5',
    '&subsetneq;': '\u228A',
    '&subsetneqq;': '\u2ACB',
    '&subsim;': '\u2AC7',
    '&subsub;': '\u2AD5',
    '&subsup;': '\u2AD3',
    '&succ;': '\u227B',
    '&succapprox;': '\u2AB8',
    '&succcurlyeq;': '\u227D',
    '&succeq;': '\u2AB0',
    '&succnapprox;': '\u2ABA',
    '&succneqq;': '\u2AB6',
    '&succnsim;': '\u22E9',
    '&succsim;': '\u227F',
    '&sum;': '\u2211',
    '&sung;': '\u266A',
    '&sup1': '\u00B9',
    '&sup1;': '\u00B9',
    '&sup2': '\u00B2',
    '&sup2;': '\u00B2',
    '&sup3': '\u00B3',
    '&sup3;': '\u00B3',
    '&sup;': '\u2283',
    '&supE;': '\u2AC6',
    '&supdot;': '\u2ABE',
    '&supdsub;': '\u2AD8',
    '&supe;': '\u2287',
    '&supedot;': '\u2AC4',
    '&suphsol;': '\u27C9',
    '&suphsub;': '\u2AD7',
    '&suplarr;': '\u297B',
    '&supmult;': '\u2AC2',
    '&supnE;': '\u2ACC',
    '&supne;': '\u228B',
    '&supplus;': '\u2AC0',
    '&supset;': '\u2283',
    '&supseteq;': '\u2287',
    '&supseteqq;': '\u2AC6',
    '&supsetneq;': '\u228B',
    '&supsetneqq;': '\u2ACC',
    '&supsim;': '\u2AC8',
    '&supsub;': '\u2AD4',
    '&supsup;': '\u2AD6',
    '&swArr;': '\u21D9',
    '&swarhk;': '\u2926',
    '&swarr;': '\u2199',
    '&swarrow;': '\u2199',
    '&swnwar;': '\u292A',
    '&szlig': '\u00DF',
    '&szlig;': '\u00DF',
    '&target;': '\u2316',
    '&tau;': '\u03C4',
    '&tbrk;': '\u23B4',
    '&tcaron;': '\u0165',
    '&tcedil;': '\u0163',
    '&tcy;': '\u0442',
    '&tdot;': '\u20DB',
    '&telrec;': '\u2315',
    '&tfr;': '\uD835\uDD31',
    '&there4;': '\u2234',
    '&therefore;': '\u2234',
    '&theta;': '\u03B8',
    '&thetasym;': '\u03D1',
    '&thetav;': '\u03D1',
    '&thickapprox;': '\u2248',
    '&thicksim;': '\u223C',
    '&thinsp;': '\u2009',
    '&thkap;': '\u2248',
    '&thksim;': '\u223C',
    '&thorn': '\u00FE',
    '&thorn;': '\u00FE',
    '&tilde;': '\u02DC',
    '&times': '\u00D7',
    '&times;': '\u00D7',
    '&timesb;': '\u22A0',
    '&timesbar;': '\u2A31',
    '&timesd;': '\u2A30',
    '&tint;': '\u222D',
    '&toea;': '\u2928',
    '&top;': '\u22A4',
    '&topbot;': '\u2336',
    '&topcir;': '\u2AF1',
    '&topf;': '\uD835\uDD65',
    '&topfork;': '\u2ADA',
    '&tosa;': '\u2929',
    '&tprime;': '\u2034',
    '&trade;': '\u2122',
    '&triangle;': '\u25B5',
    '&triangledown;': '\u25BF',
    '&triangleleft;': '\u25C3',
    '&trianglelefteq;': '\u22B4',
    '&triangleq;': '\u225C',
    '&triangleright;': '\u25B9',
    '&trianglerighteq;': '\u22B5',
    '&tridot;': '\u25EC',
    '&trie;': '\u225C',
    '&triminus;': '\u2A3A',
    '&triplus;': '\u2A39',
    '&trisb;': '\u29CD',
    '&tritime;': '\u2A3B',
    '&trpezium;': '\u23E2',
    '&tscr;': '\uD835\uDCC9',
    '&tscy;': '\u0446',
    '&tshcy;': '\u045B',
    '&tstrok;': '\u0167',
    '&twixt;': '\u226C',
    '&twoheadleftarrow;': '\u219E',
    '&twoheadrightarrow;': '\u21A0',
    '&uArr;': '\u21D1',
    '&uHar;': '\u2963',
    '&uacute': '\u00FA',
    '&uacute;': '\u00FA',
    '&uarr;': '\u2191',
    '&ubrcy;': '\u045E',
    '&ubreve;': '\u016D',
    '&ucirc': '\u00FB',
    '&ucirc;': '\u00FB',
    '&ucy;': '\u0443',
    '&udarr;': '\u21C5',
    '&udblac;': '\u0171',
    '&udhar;': '\u296E',
    '&ufisht;': '\u297E',
    '&ufr;': '\uD835\uDD32',
    '&ugrave': '\u00F9',
    '&ugrave;': '\u00F9',
    '&uharl;': '\u21BF',
    '&uharr;': '\u21BE',
    '&uhblk;': '\u2580',
    '&ulcorn;': '\u231C',
    '&ulcorner;': '\u231C',
    '&ulcrop;': '\u230F',
    '&ultri;': '\u25F8',
    '&umacr;': '\u016B',
    '&uml': '\u00A8',
    '&uml;': '\u00A8',
    '&uogon;': '\u0173',
    '&uopf;': '\uD835\uDD66',
    '&uparrow;': '\u2191',
    '&updownarrow;': '\u2195',
    '&upharpoonleft;': '\u21BF',
    '&upharpoonright;': '\u21BE',
    '&uplus;': '\u228E',
    '&upsi;': '\u03C5',
    '&upsih;': '\u03D2',
    '&upsilon;': '\u03C5',
    '&upuparrows;': '\u21C8',
    '&urcorn;': '\u231D',
    '&urcorner;': '\u231D',
    '&urcrop;': '\u230E',
    '&uring;': '\u016F',
    '&urtri;': '\u25F9',
    '&uscr;': '\uD835\uDCCA',
    '&utdot;': '\u22F0',
    '&utilde;': '\u0169',
    '&utri;': '\u25B5',
    '&utrif;': '\u25B4',
    '&uuarr;': '\u21C8',
    '&uuml': '\u00FC',
    '&uuml;': '\u00FC',
    '&uwangle;': '\u29A7',
    '&vArr;': '\u21D5',
    '&vBar;': '\u2AE8',
    '&vBarv;': '\u2AE9',
    '&vDash;': '\u22A8',
    '&vangrt;': '\u299C',
    '&varepsilon;': '\u03F5',
    '&varkappa;': '\u03F0',
    '&varnothing;': '\u2205',
    '&varphi;': '\u03D5',
    '&varpi;': '\u03D6',
    '&varpropto;': '\u221D',
    '&varr;': '\u2195',
    '&varrho;': '\u03F1',
    '&varsigma;': '\u03C2',
    '&varsubsetneq;': '\u228A\uFE00',
    '&varsubsetneqq;': '\u2ACB\uFE00',
    '&varsupsetneq;': '\u228B\uFE00',
    '&varsupsetneqq;': '\u2ACC\uFE00',
    '&vartheta;': '\u03D1',
    '&vartriangleleft;': '\u22B2',
    '&vartriangleright;': '\u22B3',
    '&vcy;': '\u0432',
    '&vdash;': '\u22A2',
    '&vee;': '\u2228',
    '&veebar;': '\u22BB',
    '&veeeq;': '\u225A',
    '&vellip;': '\u22EE',
    '&verbar;': '\u007C',
    '&vert;': '\u007C',
    '&vfr;': '\uD835\uDD33',
    '&vltri;': '\u22B2',
    '&vnsub;': '\u2282\u20D2',
    '&vnsup;': '\u2283\u20D2',
    '&vopf;': '\uD835\uDD67',
    '&vprop;': '\u221D',
    '&vrtri;': '\u22B3',
    '&vscr;': '\uD835\uDCCB',
    '&vsubnE;': '\u2ACB\uFE00',
    '&vsubne;': '\u228A\uFE00',
    '&vsupnE;': '\u2ACC\uFE00',
    '&vsupne;': '\u228B\uFE00',
    '&vzigzag;': '\u299A',
    '&wcirc;': '\u0175',
    '&wedbar;': '\u2A5F',
    '&wedge;': '\u2227',
    '&wedgeq;': '\u2259',
    '&weierp;': '\u2118',
    '&wfr;': '\uD835\uDD34',
    '&wopf;': '\uD835\uDD68',
    '&wp;': '\u2118',
    '&wr;': '\u2240',
    '&wreath;': '\u2240',
    '&wscr;': '\uD835\uDCCC',
    '&xcap;': '\u22C2',
    '&xcirc;': '\u25EF',
    '&xcup;': '\u22C3',
    '&xdtri;': '\u25BD',
    '&xfr;': '\uD835\uDD35',
    '&xhArr;': '\u27FA',
    '&xharr;': '\u27F7',
    '&xi;': '\u03BE',
    '&xlArr;': '\u27F8',
    '&xlarr;': '\u27F5',
    '&xmap;': '\u27FC',
    '&xnis;': '\u22FB',
    '&xodot;': '\u2A00',
    '&xopf;': '\uD835\uDD69',
    '&xoplus;': '\u2A01',
    '&xotime;': '\u2A02',
    '&xrArr;': '\u27F9',
    '&xrarr;': '\u27F6',
    '&xscr;': '\uD835\uDCCD',
    '&xsqcup;': '\u2A06',
    '&xuplus;': '\u2A04',
    '&xutri;': '\u25B3',
    '&xvee;': '\u22C1',
    '&xwedge;': '\u22C0',
    '&yacute': '\u00FD',
    '&yacute;': '\u00FD',
    '&yacy;': '\u044F',
    '&ycirc;': '\u0177',
    '&ycy;': '\u044B',
    '&yen': '\u00A5',
    '&yen;': '\u00A5',
    '&yfr;': '\uD835\uDD36',
    '&yicy;': '\u0457',
    '&yopf;': '\uD835\uDD6A',
    '&yscr;': '\uD835\uDCCE',
    '&yucy;': '\u044E',
    '&yuml': '\u00FF',
    '&yuml;': '\u00FF',
    '&zacute;': '\u017A',
    '&zcaron;': '\u017E',
    '&zcy;': '\u0437',
    '&zdot;': '\u017C',
    '&zeetrf;': '\u2128',
    '&zeta;': '\u03B6',
    '&zfr;': '\uD835\uDD37',
    '&zhcy;': '\u0436',
    '&zigrarr;': '\u21DD',
    '&zopf;': '\uD835\uDD6B',
    '&zscr;': '\uD835\uDCCF',
    '&zwj;': '\u200D',
    '&zwnj;': '\u200C'
};
//# sourceMappingURL=html-entities.js.map
},
"./mime-node.js":function(module,exports,require){
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const decode_strings_js_1 = require("./decode-strings.js");
const pass_through_decoder_js_1 = __importDefault(require("./pass-through-decoder.js"));
const base64_decoder_js_1 = __importDefault(require("./base64-decoder.js"));
const qp_decoder_js_1 = __importDefault(require("./qp-decoder.js"));
const errors_js_1 = require("./errors.js");
// Header lines are decoded with ignoreBOM so that a U+FEFF at the start of a line is
// kept as a character instead of being swallowed. A stripped BOM turns a line a strict
// parser skips into a genuine header, which is how a second `From:` gets smuggled past
// anything that inspects the raw message.
//
// Raw 8-bit header text is UTF-8 (RFC 6532), and a line that is not is legacy mail in a
// single byte charset, read as windows-1252 rather than as replacement characters, see
// decodeUtf8OrWindows1252.
const headerDecoder = new TextDecoder('utf-8', { ignoreBOM: true });
// number of pieces decodeFlowedText collects before joining them
const FLOWED_JOIN_INTERVAL = 4096;
// What a header line costs to hold, at the least. The decoded line, its entry in
// rawHeaderLines and the parsed header come to a few hundred bytes for a line of one
// byte, so two million such lines stayed inside maxHeadersSize while they held a few
// hundred megabytes. Counting every line for at least this much keeps the memory in step
// with the budget, 32768 lines at the default 2 MiB.
const HEADER_LINE_MIN_COST = 64;
// Trims the SP and HTAB around a field body, the only whitespace RFC 5322 reads as padding
// there. String.prototype.trim also strips U+00A0, U+FEFF, U+2028 and the rest of the
// Unicode spaces, which a raw UTF-8 header (RFC 6532) may carry as content.
//
// An index scan rather than `/^[ \t]+|[ \t]+$/g`, which retries the trailing branch at
// every position of a blank run that is followed by other text, so a single header with
// a long run of spaces in the middle took seconds to trim.
const trimWsp = (str) => {
    let start = 0;
    let end = str.length;
    while (start < end && (0, decode_strings_js_1.isWsp)(str.charCodeAt(start))) {
        start++;
    }
    while (end > start && (0, decode_strings_js_1.isWsp)(str.charCodeAt(end - 1))) {
        end--;
    }
    return str.slice(start, end);
};
// The start of a header field, the shape Python's header pattern reads: a field name of
// printable ASCII other than the colon (RFC 5322 3.6.8 ftext), an empty one included, and
// the colon itself, with the whitespace in between that processHeaders tolerates as well,
// or the `From ` of an mbox separator line, which every reader lets through
const FIELD_START = /^(?:From |[!-9;-~]*[ \t]*:)/;
// Headers that decide how this part's body is read, see processHeaders
const CONTENT_HEADERS = new Set([
    'content-type',
    'content-transfer-encoding',
    'content-disposition',
    'content-id',
    'content-description'
]);
class MimeNode {
    constructor(options) {
        this.options = options;
        this.postalMime = options.postalMime;
        // Counted across the whole message like the header size, nested message/rfc822
        // parts included, so that neither a multipart nor a forward can carry the budget
        // again for every part it declares
        const limits = this.postalMime.limits;
        this.postalMime.counters.partCount++;
        if (this.postalMime.counters.partCount > limits.maxPartCount) {
            throw (0, errors_js_1.createError)('EMAXPARTCOUNT', `Maximum MIME part count of ${limits.maxPartCount} parts exceeded`);
        }
        this.childNodes = [];
        // Cursor into childNodes for finalizeChildNodes. Every new part of a multipart
        // finalizes its parent's children, so re-walking the whole array each time is
        // quadratic in the number of parts.
        this.finalizedChildCount = 0;
        if (options.parentNode) {
            this.parentNode = options.parentNode;
            this.depth = this.parentNode.depth + 1;
            if (this.depth > limits.maxNestingDepth) {
                throw (0, errors_js_1.createError)('EMAXNESTINGDEPTH', `Maximum MIME nesting depth of ${limits.maxNestingDepth} levels exceeded`);
            }
            options.parentNode.childNodes.push(this);
        }
        else {
            this.depth = 0;
        }
        this.state = 'header';
        this.headerLines = [];
        // RFC 2046 Section 5.1.5: multipart/digest defaults to message/rfc822
        const parentMultipartType = options.parentMultipartType || null;
        const defaultContentType = parentMultipartType === 'digest' ? 'message/rfc822' : 'text/plain';
        // The value is replaced by the first matching header and the rest is derived
        // from it, see the CONTENT_HEADERS pass in processHeaders
        this.contentType = {
            value: defaultContentType,
            parsed: { value: defaultContentType, params: {} },
            multipart: false
        };
        this.contentTransferEncoding = {
            value: '8bit',
            encoding: ''
        };
        this.contentDisposition = {
            value: '',
            parsed: { value: '', params: {} }
        };
        this.headers = [];
        this.rawHeaderLines = [];
        this.contentDecoder = null;
        this.content = null;
    }
    // `transferEncoding` is the lowercased token of the header, see processHeaders. It is
    // matched whole: `x-base64` or `7bit-base64` is no encoding Python or mailparser
    // decode, and decoding it here rendered as markup a body every other reader keeps as
    // inert base64
    setupContentDecoder(transferEncoding) {
        if (transferEncoding === 'base64') {
            this.contentDecoder = new base64_decoder_js_1.default();
        }
        else if (transferEncoding === 'quoted-printable') {
            this.contentDecoder = new qp_decoder_js_1.default();
        }
        else {
            this.contentDecoder = new pass_through_decoder_js_1.default();
        }
    }
    // `boundaryEnded` tells that the part was ended by a multipart boundary, which owns
    // the line break after the last line of the part (RFC 2046 5.1.1)
    async finalize(boundaryEnded = false) {
        if (this.state === 'finished') {
            return;
        }
        if (this.state === 'header') {
            this.endHeaders();
        }
        // remove self from boundary listing
        let boundaries = this.postalMime.boundaries;
        for (let i = boundaries.length - 1; i >= 0; i--) {
            let boundary = boundaries[i];
            if (boundary.node === this) {
                boundaries.splice(i, 1);
                break;
            }
        }
        await this.finalizeChildNodes(boundaryEnded);
        this.content = this.contentDecoder ? await this.contentDecoder.finalize(boundaryEnded) : null;
        // The decoder buffers every body line it received, so keeping it around
        // retains a second copy of the content for the lifetime of the node.
        // Nothing reads it once the node is finished, so release it here.
        this.contentDecoder = null;
        this.state = 'finished';
    }
    async finalizeChildNodes(boundaryEnded = false) {
        // Children are only ever appended, so everything before the cursor is already
        // finished and re-visiting it only costs time.
        while (this.finalizedChildCount < this.childNodes.length) {
            await this.childNodes[this.finalizedChildCount++].finalize(boundaryEnded);
        }
    }
    // Strip RFC 822 comments (parenthesized text) from structured header values.
    //
    // Inside an unquoted parameter value a parenthesis that continues the current token is
    // content, because `filename=Invoice(1).pdf` is a filename and not a token followed by
    // a comment, and deleting the parens silently renames the attachment.
    stripComments(str) {
        let result = '';
        let depth = 0;
        let escaped = false;
        let inQuote = false;
        // where the outermost comment opened, for the unbalanced case below
        let commentStart = -1;
        // A parameter value starts at `=` and ends at the `;` that begins the next one
        let inParameterValue = false;
        // The characters kept are copied into the result as runs, a run ending at the
        // next character dropped. Appended one at a time they made a cons string of a
        // node per character, tens of megabytes of pointer chasing for the collector on a
        // header of a megabyte, and the parse grew faster than the header did
        let runStart = 0;
        const drop = (i) => {
            result += str.slice(runStart, i);
            runStart = i + 1;
        };
        // Whether anything has been kept, and whether the last character kept is SP or
        // HTAB. Kept up to date on every character, because testing `/[ \t]$/` against the
        // result flattens the whole string on each `(` and is quadratic in the length of
        // the header.
        let keptAny = false;
        let endsWithWsp = false;
        const keep = (i) => {
            keptAny = true;
            endsWithWsp = (0, decode_strings_js_1.isWsp)(str.charCodeAt(i));
        };
        // A comment may only appear where linear whitespace is allowed, so inside a
        // parameter value the parenthesis has to follow whitespace to open one. Outside
        // one, eg. after the type itself, anything goes.
        const opensComment = () => !inParameterValue || !keptAny || endsWithWsp;
        for (let i = 0; i < str.length; i++) {
            const chr = str.charAt(i);
            if (escaped) {
                escaped = false;
            }
            else if (chr === '\\') {
                escaped = true;
            }
            else if (chr === '"' && depth === 0) {
                inQuote = !inQuote;
            }
            else if (!inQuote) {
                if (chr === '(' && opensComment()) {
                    if (depth === 0) {
                        commentStart = i;
                    }
                    depth++;
                    drop(i);
                    continue;
                }
                if (chr === ')' && depth > 0) {
                    depth--;
                    drop(i);
                    continue;
                }
                if (depth === 0) {
                    if (chr === '=') {
                        inParameterValue = true;
                    }
                    else if (chr === ';') {
                        inParameterValue = false;
                    }
                }
            }
            if (depth === 0) {
                keep(i);
            }
            else {
                drop(i);
            }
        }
        if (depth === 0) {
            return result + str.slice(runStart);
        }
        // An unbalanced `(` is not a comment. Dropping everything after it would take any
        // parameter that follows with it, including the boundary that holds the message
        // together, so the dangling text is only discarded when nothing follows it.
        return str.indexOf(';', commentStart) < 0 ? result + str.slice(runStart) : str;
    }
    parseStructuredHeader(str) {
        // Strip RFC 822 comments before parsing
        str = this.stripComments(str);
        let response = {
            value: '',
            params: {}
        };
        let key = false;
        let value = '';
        let stage = 'value';
        // Whitespace seen outside a quoted string is held back until a significant
        // character follows it, so surrounding whitespace can be dropped without
        // trimming spaces the sender quoted on purpose. Trimming the stored value
        // instead loses the trailing space in `filename*0="Annual Report "`, which the
        // next continuation section is meant to be appended to.
        let pendingSpace = '';
        let quoteClosed = false;
        let quote = false;
        let escaped = false;
        let chr;
        // Whitespace ahead of the first character of a value is padding and is dropped, the
        // whitespace between two characters of it is content
        const flushSpace = () => {
            if (value.length) {
                value += pendingSpace;
            }
            pendingSpace = '';
        };
        // The characters of the value are copied as runs, see stripComments. A run is the
        // characters from runStart on, none is open while it is -1, and it is closed by
        // whatever is not a character of the value
        let runStart = -1;
        const closeRun = (end) => {
            if (runStart >= 0) {
                value += str.slice(runStart, end);
                runStart = -1;
            }
        };
        // the character at i is part of the value
        const addChr = (i) => {
            if (runStart < 0) {
                flushSpace();
                runStart = i;
            }
        };
        const takeValue = () => {
            const result = value;
            value = '';
            pendingSpace = '';
            quoteClosed = false;
            return result;
        };
        // A duplicated parameter resolves to its first occurrence, matching how duplicated
        // headers are resolved. Letting the last one win means `boundary="b"; boundary="c"`
        // registers a boundary that no delimiter in the message matches, which drops the
        // body without an error. hasOwnProperty, because a parameter may be named
        // `constructor` or `toString`. A name is a token and a token is never empty, so the
        // nameless parameter of `text/plain; =v` names nothing and is dropped.
        const storeParam = (name, result) => {
            if (name && !Object.prototype.hasOwnProperty.call(response.params, name)) {
                response.params[name] = result;
            }
        };
        const storeValue = () => {
            const result = takeValue();
            if (key === false) {
                response.value = result;
            }
            else {
                storeParam(key, result);
            }
        };
        // A parameter name with no `=` is a valueless parameter, not the start of the
        // next one. Without this the name would keep growing across the `;` and swallow
        // whatever followed, which is how `x=1; flag; boundary="AAA"` loses its boundary.
        const storeEmptyKey = () => {
            storeParam(takeValue().trim().toLowerCase(), '');
        };
        for (let i = 0, len = str.length; i < len; i++) {
            chr = str.charAt(i);
            switch (stage) {
                case 'key':
                    if (chr === '=') {
                        closeRun(i);
                        key = takeValue().trim().toLowerCase();
                        stage = 'value';
                        break;
                    }
                    if (chr === ';') {
                        closeRun(i);
                        storeEmptyKey();
                        break;
                    }
                    if (runStart < 0) {
                        runStart = i;
                    }
                    break;
                case 'value':
                    if (quoteClosed && chr !== ';') {
                        // Nothing behind a closed quoted string reaches the value. RFC 2045
                        // says a parameter value is a token or a quoted string, not both, so
                        // what follows one is junk and only the `;` that ends the parameter
                        // still counts. Tested ahead of the branches rather than beside the
                        // append at the foot of them, where each branch above was a way
                        // around it. A second `"` reopened quoting, which both carried the
                        // whitespace in front of it into the value and took the `;` along, so
                        // `boundary="AAA" "; boundary=BBB"` registered a boundary of `AAA `
                        // that no delimiter matches and the whole body was dropped without an
                        // error; the escape branch appended arbitrary characters the same way.
                        // quoteClosed is only ever set while no quote is open, and this is
                        // what keeps one from being opened afterwards.
                        escaped = false;
                        break;
                    }
                    if (escaped) {
                        addChr(i);
                    }
                    else if (quote && chr === '\\') {
                        // backslash only escapes inside a quoted string, everywhere else
                        // it is an ordinary character. Treating it as an escape turns
                        // `filename=C:\Users\me\a.txt` into `C:Usersmea.txt`.
                        closeRun(i);
                        escaped = true;
                        continue;
                    }
                    else if (quote && chr === quote) {
                        closeRun(i);
                        quote = false;
                        quoteClosed = true;
                    }
                    else if (!quote && chr === '"') {
                        closeRun(i);
                        quote = chr;
                        flushSpace();
                    }
                    else if (!quote && chr === ';') {
                        closeRun(i);
                        storeValue();
                        stage = 'key';
                    }
                    else if (!quote && (chr === ' ' || chr === '\t')) {
                        closeRun(i);
                        pendingSpace += chr;
                    }
                    else {
                        addChr(i);
                    }
                    escaped = false;
                    break;
            }
        }
        closeRun(str.length);
        // finalize remainder
        if (stage === 'value') {
            storeValue();
        }
        else {
            // treat as key without value, see emptykey:
            // Header-Key: somevalue; key=value; emptykey
            storeEmptyKey();
        }
        if (response.value) {
            response.value = response.value.toLowerCase();
        }
        // convert Parameter Value Continuations into single strings
        (0, decode_strings_js_1.decodeParameterValueContinuations)(response);
        return response;
    }
    // Unfolds format=flowed text (RFC 3676 4.1). A line is read as its quote marks, one
    // space of stuffing and its content, in that order, and a line whose content ends in a
    // space is flowed: the next line of the same quote depth continues its paragraph. The
    // paragraph ends at a fixed line, at a change of quote depth and at the signature
    // separator, which is neither flowed nor fixed. Joining a quoted paragraph used to
    // leave the quote marks of the continuation lines inside the text, so a quoted reply
    // read `> one > two` instead of `> one two`.
    //
    // The quote marks and stuffing of the first line of a paragraph are kept as they were
    // written, so a fixed quoted line comes out exactly as it went in. An unquoted stuffed
    // line loses its stuffing, which is all the stuffing is for.
    decodeFlowedText(str, delSp) {
        // Pieces of the result. Growing a single string instead flattens the whole
        // paragraph again on each line, which is quadratic in the length of a paragraph.
        // `parts` holds an entry or two per line, so it is joined into `chunks` every few
        // thousand entries to keep memory following the length of the text rather than
        // the number of lines. Its last entry stays behind, since delsp trims it when
        // the next line continues the paragraph.
        const chunks = [];
        let parts = [];
        // whether the previous line was flowed, and the quote depth of its paragraph
        let flowed = false;
        let depth = 0;
        for (let lineStart = 0; lineStart <= str.length;) {
            let lineEnd = str.indexOf('\n', lineStart);
            if (lineEnd < 0) {
                lineEnd = str.length;
            }
            const line = str.slice(lineStart, lineEnd);
            let quoteDepth = 0;
            while (line.charCodeAt(quoteDepth) === 0x3e /* > */) {
                quoteDepth++;
            }
            const contentStart = line.charCodeAt(quoteDepth) === 0x20 ? quoteDepth + 1 : quoteDepth;
            const content = line.slice(contentStart);
            const isSignature = content === '-- ';
            if (flowed && quoteDepth === depth && !isSignature) {
                if (delSp) {
                    // delsp adds the space to make the text foldable, so it is not content
                    const last = parts[parts.length - 1];
                    parts[parts.length - 1] = last.slice(0, -1);
                }
                parts.push(content);
            }
            else {
                if (lineStart) {
                    parts.push('\n');
                }
                parts.push(quoteDepth ? line : content);
            }
            flowed = !isSignature && content.endsWith(' ');
            depth = quoteDepth;
            if (parts.length >= FLOWED_JOIN_INTERVAL) {
                const last = parts.pop();
                chunks.push(parts.join(''));
                parts = [last];
            }
            lineStart = lineEnd + 1;
        }
        chunks.push(parts.join(''));
        return chunks.join('');
    }
    getTextContent() {
        if (!this.content) {
            return '';
        }
        // The bytes keep the line endings the part was sent with, see PassThroughDecoder,
        // which differ from one transfer encoding to the next. Text is normalized to LF so
        // that a consumer does not get CRLF from one message and LF from another
        let str = (0, decode_strings_js_1.decodeText)(this.content, this.contentType.parsed.params.charset, this.contentType.parsed.value === 'text/html').replace(/\r\n/g, '\n');
        // format=flowed is defined for text/plain (RFC 3676), and a browser never unfolds
        // an html part. Unfolded here anyway, `<scri \r\npt>` under delsp=yes was joined
        // into a tag that neither Python nor a browser given the raw bytes sees
        if (this.contentType.parsed.value === 'text/plain' && /^flowed$/i.test(this.contentType.parsed.params.format)) {
            str = this.decodeFlowedText(str, /^yes$/i.test(this.contentType.parsed.params.delsp));
        }
        return str;
    }
    processHeaders() {
        // First pass: group folded continuation lines with the header they belong to.
        //
        // Only SP and HTAB continue a header (RFC 5322 3.2.2 WSP). JS `\s` also matches
        // NBSP, vertical tab, form feed and U+2028, so a line starting with one of those
        // used to be absorbed into the header above it and disappear from both `headers`
        // and `headerLines` while a strict parser still sees it as a header of its own.
        //
        // Collecting into an array and joining once keeps this linear. Appending onto the
        // previous string in a backward pass re-scans the joined value on every line,
        // which is quadratic in the number of folds and lets a message that fits inside
        // maxHeadersSize burn seconds of CPU.
        let foldedLines = [];
        for (let line of this.headerLines) {
            if (foldedLines.length && /^[ \t]/.test(line)) {
                foldedLines[foldedLines.length - 1].push(line);
            }
            else {
                foldedLines.push([line]);
            }
        }
        let seenContentHeaders = new Set();
        // Second pass: process headers in document order
        for (let parts of foldedLines) {
            let rawLine = parts.join('\n');
            // The field name is kept as it was written, whitespace included. RFC 5322 puts
            // the colon right after the name and only its obsolete syntax lets whitespace
            // come between the two, so `From :` names a different field than `From:`, as
            // Go reads it, and the first line of a message may start with whitespace while
            // it is a fold of nothing, a line Python drops and Go rejects the message for.
            // Trimming the name made such a line the canonical header, and since the first
            // occurrence of a header wins, a ` From:` first line or a `From :` ahead of the
            // genuine From named the sender here while a verifier reading the other had
            // authenticated the one this parser ignored. The same put a Content-Type ahead
            // of the one every other parser reads the body by. Leaving the whitespace in
            // the key keeps the line visible without letting it collide with a genuine
            // header. A line whose name holds anything else, a non-ASCII space say, is no
            // field at all and ends the headers, see feed.
            let sep = rawLine.indexOf(':');
            let rawKey = sep < 0 ? rawLine : rawLine.slice(0, sep);
            // Store raw line with lowercase key
            this.rawHeaderLines.push({
                key: rawKey.toLowerCase(),
                line: rawLine
            });
            // Unfolding removes the line break and keeps the folding whitespace, so
            // `Subject: Hello\r\n    World` stays `Hello    World`. Collapsing every
            // whitespace run instead also rewrote boundary values and filenames, and it
            // replaced the non-ASCII spaces that raw UTF-8 headers (RFC 6532) may carry.
            let unfoldedLine = parts.join('');
            sep = unfoldedLine.indexOf(':');
            let key = sep < 0 ? unfoldedLine : unfoldedLine.slice(0, sep);
            // A bare CR is not legal in a field body, see foldLineBreaks
            let value = sep < 0 ? '' : trimWsp((0, decode_strings_js_1.foldLineBreaks)(unfoldedLine.slice(sep + 1)));
            this.headers.push({ key: key.toLowerCase(), originalKey: key, value });
            // A header that decides how the body is read must resolve the same way every
            // time it is duplicated, otherwise a message can present one Content-Type to a
            // scanner and a different one here. Every one of these takes the first
            // occurrence and later copies are ignored.
            const lowerKey = key.toLowerCase();
            if (CONTENT_HEADERS.has(lowerKey) && !seenContentHeaders.has(lowerKey)) {
                seenContentHeaders.add(lowerKey);
                switch (lowerKey) {
                    case 'content-type':
                        this.contentType.value = value;
                        break;
                    case 'content-transfer-encoding':
                        this.contentTransferEncoding.value = value;
                        break;
                    case 'content-disposition':
                        this.contentDisposition.value = value;
                        break;
                    case 'content-id':
                        this.contentId = value;
                        break;
                    case 'content-description':
                        this.contentDescription = value;
                        break;
                }
            }
        }
        this.contentType.parsed = this.parseStructuredHeader(this.contentType.value);
        this.contentType.multipart = /^multipart\//i.test(this.contentType.parsed.value)
            ? this.contentType.parsed.value.slice(this.contentType.parsed.value.indexOf('/') + 1)
            : false;
        // A boundary does not end in whitespace (RFC 2046 5.1.1, bcharsnospace), and one
        // written with some anyway, `boundary="abc "`, is `abc` to Python. Registered as
        // written it matched no delimiter line and the whole body was dropped without a
        // trace, an attachment included. A delimiter line written with the space still
        // matches, since a boundary line may end in whitespace. trimEnd rather than
        // trimWsp, because Python strips any whitespace here.
        //
        // A boundary is ASCII as well (RFC 2046 5.1.1, bchars), and Python matches no line
        // against one that is not. One holding a non-ASCII character came out of a header
        // line decoded as windows-1252 and re-encoded as UTF-8, or was written in UTF-8 to
        // begin with. Matched here, `boundary="ab\xE9cd"` found the parts under lines of
        // `--ab\xC3\xA9cd` that a scanner built on Python never saw, and with the same byte
        // on both sides nothing matched and the body was dropped without a trace. Such a
        // boundary counts as none, so the body reads as text below
        let boundary = this.contentType.multipart ? (this.contentType.parsed.params.boundary || '').trimEnd() : '';
        if (/[^\x00-\x7f]/.test(boundary)) {
            boundary = '';
        }
        if (this.contentType.multipart && !boundary) {
            // A multipart without the boundary RFC 2046 5.1.1 requires, or with one it does
            // not allow, has no parts to find, and its body used to be dropped without a
            // trace. RFC 2045 5.2 recommends reading an invalid Content-Type as plain text,
            // which is also what the body of such a message usually is
            this.contentType.parsed.value = 'text/plain';
            this.contentType.multipart = false;
        }
        if (this.contentType.multipart) {
            // add self to boundary terminator listing
            this.postalMime.boundaries.push({
                value: decode_strings_js_1.textEncoder.encode(boundary),
                node: this
            });
        }
        this.contentDisposition.parsed = this.parseStructuredHeader(this.contentDisposition.value);
        // The disposition type is a token, so it ends at the first whitespace. Read whole,
        // `attachment garbage` was neither attachment nor inline, and a text/html part
        // declaring it was rendered as the body while Python and mailparser keep it an
        // attachment. The type of a Content-Type stays as it is: `text/html garbage` is no
        // html to them either, and reading it as html here would be the reverse mistake
        const disposition = this.contentDisposition.parsed.value;
        const dispositionEnd = disposition.search(/[ \t]/);
        if (dispositionEnd >= 0) {
            this.contentDisposition.parsed.value = disposition.slice(0, dispositionEnd);
        }
        // The token at the start of the value, behind the whitespace a leading comment
        // leaves: `(comment) base64`, `base64 (comment)` and `base64 x` decode, as they do
        // for Python. A quoted token does not. `"base64"` is raw base64 to Python and to
        // mailparser, and decoding it here rendered as markup a body both hand through as
        // it is. Taking the first token anywhere in the value read it, and `x "base64"`.
        this.contentTransferEncoding.encoding = (this.stripComments(this.contentTransferEncoding.value)
            .toLowerCase()
            .match(/^[ \t]*([\w-]+)/) || ['', ''])[1];
        this.setupContentDecoder(this.contentTransferEncoding.encoding);
        // the lines live on in rawHeaderLines and headers, so the raw copies are released
        this.headerLines = [];
    }
    // Ends the header section and sets up the body
    endHeaders() {
        this.state = 'body';
        this.processHeaders();
    }
    // Returns true when the line was not consumed: the headers ended with the line before
    // it, and the parser has to read it again, since the boundary this part declares was
    // not known yet when the line was checked for one
    feed(line, lineBreak) {
        switch (this.state) {
            case 'header': {
                if (!line.length) {
                    this.endHeaders();
                    return false;
                }
                // Counted across the whole message, not per part. A per-node budget lets a
                // multipart carry the limit again for every part it declares, so a message
                // many times over the limit still parses.
                this.postalMime.counters.headerSize += Math.max(line.length, HEADER_LINE_MIN_COST);
                const maxHeadersSize = this.postalMime.limits.maxHeadersSize;
                if (this.postalMime.counters.headerSize > maxHeadersSize) {
                    throw (0, errors_js_1.createError)('EMAXHEADERSIZE', `Maximum header size of ${maxHeadersSize} bytes exceeded`);
                }
                const text = (0, decode_strings_js_1.decodeUtf8OrWindows1252)(line, headerDecoder);
                // A line that is neither a header field nor a fold ends the headers, as it
                // does for Python and for an MTA that stores the header block on its own,
                // and Go rejects the message for it. Read on as a header here, a Content-Type
                // or a From behind such a line was honoured where a scanner built on Python
                // had read it as the first line of a text/plain body.
                //
                // A line of nothing but whitespace is a fold (RFC 5322 4.2, obs-FWS), but
                // broken generators also put one where the empty line that ends the headers
                // belongs, and reading it as a fold used to turn the whole body into one
                // more header. The next line decides: a field or a fold keeps it a fold,
                // anything else ends the headers, as it does for Python
                if (!(0, decode_strings_js_1.isWsp)(line[0]) && !FIELD_START.test(text)) {
                    this.endHeaders();
                    return true;
                }
                this.headerLines.push(text);
                break;
            }
            case 'body':
                // add line to body. processHeaders installs a decoder before the state
                // becomes body, and the only time the decoder is released is finalize,
                // which moves the state on to finished, so the guard only narrows the type
                if (this.contentDecoder) {
                    this.contentDecoder.update(line, lineBreak);
                }
                break;
        }
        return false;
    }
}
exports.default = MimeNode;
Object.defineProperty(exports.default, 'default', { value: exports.default, enumerable: false, writable: true, configurable: true });
module.exports = exports.default;
//# sourceMappingURL=mime-node.js.map
},
"./otp-token.js":function(module,exports,require){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseStringItem = parseStringItem;
exports.isOtpOrigin = isOtpOrigin;
exports.getOtp = getOtp;
// Parser for the OTP-Token header of draft-goto-otp-token-01, an Internet-Draft that expires
// on 25 March 2027. By then check for a newer revision of the draft or a published RFC, the
// header name and its parameters are still open questions in the draft.
//
// The header value is a structured field item (RFC 9651): a String holding the passcode,
// with an `origin` parameter naming the origin the passcode is bound to. Unknown parameters
// are ignored, but they still have to be valid, otherwise the whole field fails to parse.
// RFC 9651 lets a parser limit the size of a field. A passcode and an origin take well under
// a kilobyte, the limit keeps the regular expressions below away from megabyte inputs
const MAX_FIELD_LENGTH = 8192;
// The bare item syntax of RFC 9651 4.2.3.1, keyed by the first character of the item. An
// Integer has at most 15 digits, a Decimal at most 12 before and 1 to 3 after the dot, and a
// Date is an Integer. Whatever follows a match is left for the caller, which only accepts a
// parameter separator or the end of the field, so a 16th digit or a 4th decimal fails there
const NUMBER = /-?(?:\d{1,12}\.\d{1,3}|\d{1,15})/y;
const STRING = /"((?:[\x20\x21\x23-\x5b\x5d-\x7e]|\\["\\])*)"/y;
const TOKEN = /[A-Za-z*][!#$%&'*+\-.^_`|~0-9A-Za-z:/]*/y;
const BYTE_SEQUENCE = /:[A-Za-z0-9+/=]*:/y;
const BOOLEAN = /\?[01]/y;
const DATE = /@-?\d{1,15}/y;
const DISPLAY_STRING = /%"((?:[\x20\x21\x23\x24\x26-\x7e]|%[0-9a-f]{2})*)"/y;
const KEY = /[a-z*][a-z0-9_\-.*]*/y;
const SPACES = / */y;
// Matches the sticky expression at the cursor and moves past it, returns null if it does not match
function match(cursor, re) {
    re.lastIndex = cursor.pos;
    const result = re.exec(cursor.input);
    if (result) {
        cursor.pos = re.lastIndex;
    }
    return result;
}
// RFC 9651 4.2.5, returns the unescaped String or null if there is no valid String at the cursor
function parseString(cursor) {
    const result = match(cursor, STRING);
    return result && result[1].replace(/\\(["\\])/g, '$1');
}
// RFC 9651 4.2.10. The percent encoded bytes must be valid UTF-8, which decodeURIComponent
// checks as it decodes them
function isDisplayString(cursor) {
    const result = match(cursor, DISPLAY_STRING);
    if (!result) {
        return false;
    }
    try {
        decodeURIComponent(result[1]);
        return true;
    }
    catch {
        return false;
    }
}
// RFC 9651 4.2.3.1. Returns the value of a String, true for any other valid bare item and
// false for an invalid one
function parseBareItem(cursor) {
    const c = cursor.input.charAt(cursor.pos);
    switch (c) {
        case '"':
            return parseString(cursor) ?? false;
        case ':':
            return !!match(cursor, BYTE_SEQUENCE);
        case '?':
            return !!match(cursor, BOOLEAN);
        case '@':
            return !!match(cursor, DATE);
        case '%':
            return isDisplayString(cursor);
    }
    return !!match(cursor, c === '-' || (c >= '0' && c <= '9') ? NUMBER : TOKEN);
}
/**
 * Parses a structured field item (RFC 9651 4.2 with field_type "item") whose bare item is a
 * String. Returns the String and the String parameters, or null if the value does not parse
 * or the bare item is of another type. A parameter of any other type is stored as true
 * @internal
 */
function parseStringItem(value) {
    const cursor = { input: value, pos: 0 };
    match(cursor, SPACES);
    const item = parseString(cursor);
    if (item === null) {
        return null;
    }
    // a later parameter with the same key replaces the earlier one
    const params = new Map();
    while (cursor.input[cursor.pos] === ';') {
        cursor.pos++;
        match(cursor, SPACES);
        const key = match(cursor, KEY);
        if (!key) {
            return null;
        }
        let paramValue = true;
        if (cursor.input[cursor.pos] === '=') {
            cursor.pos++;
            paramValue = parseBareItem(cursor);
            if (paramValue === false) {
                return null;
            }
        }
        params.set(key[0], paramValue);
    }
    match(cursor, SPACES);
    return cursor.pos === cursor.input.length ? { value: item, params } : null;
}
/**
 * Checks that the origin is the canonical ASCII serialization of a potentially trustworthy
 * origin, as the draft requires: https, or http on a loopback host
 * @internal
 */
function isOtpOrigin(origin) {
    let url;
    try {
        url = new URL(origin);
    }
    catch {
        return false;
    }
    // the URL parser lowercases the host, converts it to punycode and drops the default port, so
    // a value that is not canonical, or has a path, userinfo or an opaque origin, does not match
    // its own origin. The WHATWG parser lets characters such as a quote or a brace into a host,
    // which the origin grammar (RFC 6454) does not allow, so only a DNS name, an IPv4 address or a
    // bracketed IPv6 address is accepted
    if (url.origin !== origin || !/^([a-z0-9_-]+\.)*[a-z0-9_-]+$|^\[[0-9a-f:.]+\]$/.test(url.hostname)) {
        return false;
    }
    const isLoopback = /^(localhost|.+\.localhost|127(\.\d+){3}|\[::1\])$/.test(url.hostname);
    return url.protocol === 'https:' || (url.protocol === 'http:' && isLoopback);
}
/**
 * Returns the one-time passcode from the OTP-Token header of a message, following the
 * receiver steps of the draft (section 3.2), or undefined if the message has no valid one.
 * Only the header of the message itself counts, the draft has an OTP-Token in a MIME part
 * ignored, and more than one OTP-Token header makes the message have none
 * @internal
 */
function getOtp(headers) {
    let otpHeader;
    for (const header of headers) {
        if (header.key === 'otp-token') {
            if (otpHeader) {
                return undefined;
            }
            otpHeader = header;
        }
    }
    if (!otpHeader || otpHeader.value.length > MAX_FIELD_LENGTH) {
        return undefined;
    }
    // the header value is already unfolded, which the draft requires before the structured field parse
    const parsed = parseStringItem(otpHeader.value);
    const origin = parsed?.params.get('origin');
    // an empty passcode is valid syntax, but there is nothing in it to fill in
    if (!parsed?.value || typeof origin !== 'string' || !isOtpOrigin(origin)) {
        return undefined;
    }
    return { code: parsed.value, origin };
}
//# sourceMappingURL=otp-token.js.map
},
"./pass-through-decoder.js":function(module,exports,require){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const decode_strings_js_1 = require("./decode-strings.js");
// Hands the body through as it is, the line endings included.
//
// The line break is written when the next line arrives, not after each line. The CRLF in
// front of a multipart boundary belongs to the boundary (RFC 2046 5.1.1), so the last line
// of a part ended by a boundary must not carry one.
//
// The break written is the one the line came with. Writing LF for every line rewrote the
// bytes of every 7bit, 8bit and binary part: an attached message lost each of its CR and a
// binary attachment came out corrupted. Text is normalized to LF where it is read as text
// instead, see MimeNode.getTextContent.
//
// The lines of a part, breaks included, are one contiguous range of the message, so the
// decoder keeps the bounds of that range rather than a chunk per line: a Blob of two parts
// per line took 60 times longer to assemble than one of a single part.
class PassThroughDecoder {
    constructor() {
        this.chunks = [];
        this.runBuffer = null;
        this.runStart = 0;
        this.runEnd = 0;
        this.pendingLineBreak = null;
    }
    // Whether the bytes sit in the run's buffer right at the end of the run
    continuesRun(bytes) {
        return bytes.buffer === this.runBuffer && bytes.byteOffset === this.runEnd;
    }
    flushRun() {
        if (this.runBuffer && this.runEnd > this.runStart) {
            this.chunks.push(new Uint8Array(this.runBuffer, this.runStart, this.runEnd - this.runStart));
        }
        this.runBuffer = null;
    }
    update(line, lineBreak) {
        const pending = this.pendingLineBreak;
        if (pending &&
            this.continuesRun(pending) &&
            line.buffer === this.runBuffer &&
            line.byteOffset === this.runEnd + pending.byteLength) {
            // the break follows the run and the line follows the break, so the run grows
            this.runEnd = line.byteOffset + line.byteLength;
        }
        else {
            this.flushRun();
            if (pending) {
                this.chunks.push(pending);
            }
            this.runBuffer = line.buffer;
            this.runStart = line.byteOffset;
            this.runEnd = line.byteOffset + line.byteLength;
        }
        this.pendingLineBreak = lineBreak;
    }
    // A part ended by the end of the message has no boundary to own its final line
    // break, so there it stays content
    finalize(boundaryEnded = false) {
        const pending = this.pendingLineBreak;
        if (!boundaryEnded && pending) {
            if (this.continuesRun(pending)) {
                this.runEnd += pending.byteLength;
            }
            else {
                this.flushRun();
                this.chunks.push(pending);
            }
        }
        this.flushRun();
        // convert an array of arraybuffers into a blob and then back into a single arraybuffer
        return (0, decode_strings_js_1.blobToArrayBuffer)(new Blob(this.chunks, { type: 'application/octet-stream' }));
    }
}
exports.default = PassThroughDecoder;
Object.defineProperty(exports.default, 'default', { value: exports.default, enumerable: false, writable: true, configurable: true });
module.exports = exports.default;
//# sourceMappingURL=pass-through-decoder.js.map
},
"./postal-mime.js":function(module,exports,require){
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.decodeWords = exports.addressParser = void 0;
const mime_node_js_1 = __importDefault(require("./mime-node.js"));
const text_format_js_1 = require("./text-format.js");
const address_parser_js_1 = __importDefault(require("./address-parser.js"));
exports.addressParser = address_parser_js_1.default;
const decode_strings_js_1 = require("./decode-strings.js");
Object.defineProperty(exports, "decodeWords", { enumerable: true, get: function () { return decode_strings_js_1.decodeWords; } });
const base64_encoder_js_1 = require("./base64-encoder.js");
const errors_js_1 = require("./errors.js");
const otp_token_js_1 = require("./otp-token.js");
function isReadableStream(value) {
    return !!value && typeof value.getReader === 'function';
}
function isBlob(value) {
    return value instanceof Blob || Object.prototype.toString.call(value) === '[object Blob]';
}
// Checked by tag rather than instanceof, which fails for a buffer from another realm
function isArrayBuffer(value) {
    const tag = Object.prototype.toString.call(value);
    return tag === '[object ArrayBuffer]' || tag === '[object SharedArrayBuffer]';
}
const ATTACHMENT_ENCODINGS = new Set(['arraybuffer', 'base64', 'utf8']);
// Checked up front, an unknown encoding used to reject only once the whole message had
// been parsed
function parseAttachmentEncoding(value) {
    const encoding = String(value || '')
        .replace(/[-_\s]/g, '')
        .toLowerCase() || 'arraybuffer';
    if (!ATTACHMENT_ENCODINGS.has(encoding)) {
        throw (0, errors_js_1.createError)('EINVALIDOPTION', `Unknown attachment encoding ${encoding}`);
    }
    return encoding;
}
// Renders one entry of a node as the requested text type. A text part of the other type
// is converted, and a nested message becomes a header block in that format
function renderEntry(textEntry, textType, convert) {
    if (textEntry.type === 'subMessage') {
        return textType === 'html' ? (0, text_format_js_1.formatHtmlHeader)(textEntry.value) : (0, text_format_js_1.formatTextHeader)(textEntry.value);
    }
    if (!convert) {
        return textEntry.value;
    }
    return textType === 'html' ? (0, text_format_js_1.textToHtml)(textEntry.value) : (0, text_format_js_1.htmlToText)(textEntry.value);
}
// The line break given to the last line of a message that ends without one, see readLine
const LINE_FEED = new Uint8Array([0x0a]);
const MAX_NESTING_DEPTH = 256;
const MAX_HEADERS_SIZE = 2 * 1024 * 1024;
// The depth limit does not bound the size of the tree. An empty part costs six bytes of
// input (`--b` and a blank line) and over a kilobyte of parser state at its peak, so a
// flat multipart of a million empty parts took a 7 MB message to 1.4 GB of memory.
const MAX_PART_COUNT = 10000;
// Inline message/rfc822 parts are parsed recursively. Without a dedicated limit
// each nesting level spawns a new parser that retains the full nested message,
// so a small crafted email can exhaust memory (OOM crash). Cap the recursion and
// treat deeper nested messages as regular attachments instead.
const MAX_RFC822_NESTING_DEPTH = 10;
// The From, To, Cc and Bcc of every inline message/rfc822 part are rendered into the
// text and html of the parent, an address of one or two bytes as some 60 characters of
// html. maxHeadersSize bounds the header bytes, not the addresses they hold, so without
// a limit of their own the output grows with the number of forwards.
const MAX_FORWARDED_ADDRESSES = 10000;
// the number of entries the header formatters render for a list of addresses, a group
// counted along with each of its members
function countAddresses(addresses) {
    if (!addresses) {
        return 0;
    }
    let count = 0;
    for (const address of Array.isArray(addresses) ? addresses : [addresses]) {
        count += 1 + (address.group ? address.group.length : 0);
    }
    return count;
}
// Limit options must be validated rather than falsy-coalesced. `0` would silently
// restore the default, and a string or NaN disables the limit altogether, because
// every `size > limit` comparison against such a value is false. Callers that
// forward a request supplied options object would otherwise hand an attacker a way
// to turn the limits off.
function parseLimitOption(value, defaultValue, name, min = 0) {
    if (value === undefined || value === null) {
        return defaultValue;
    }
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min) {
        throw (0, errors_js_1.createError)('EINVALIDOPTION', `${name} must be a ${min ? 'positive' : 'non-negative'} integer`);
    }
    return value;
}
function parseLimits(options) {
    return {
        maxNestingDepth: parseLimitOption(options.maxNestingDepth, MAX_NESTING_DEPTH, 'maxNestingDepth'),
        maxHeadersSize: parseLimitOption(options.maxHeadersSize, MAX_HEADERS_SIZE, 'maxHeadersSize'),
        // The root part is always counted, so a limit of zero can parse nothing, not even
        // an empty message, and it threw EMAXPARTCOUNT from the constructor, where only
        // EINVALIDOPTION is thrown
        maxPartCount: parseLimitOption(options.maxPartCount, MAX_PART_COUNT, 'maxPartCount', 1),
        // A limit of 0 disables inline parsing entirely, so every message/rfc822 part
        // becomes an attachment.
        maxRfc822NestingDepth: parseLimitOption(options.maxRfc822NestingDepth, MAX_RFC822_NESTING_DEPTH, 'maxRfc822NestingDepth'),
        maxForwardedAddresses: parseLimitOption(options.maxForwardedAddresses, MAX_FORWARDED_ADDRESSES, 'maxForwardedAddresses')
    };
}
class PostalMime {
    /**
     * Parses a raw email message
     *
     * @param buf Raw email message
     * @param options Parser options
     * @returns The parsed email
     */
    // async so that an invalid option rejects the returned promise instead of throwing
    // synchronously, which would escape a `.catch()` chain
    static async parse(buf, options) {
        const parser = new PostalMime(options);
        return parser.parse(buf);
    }
    constructor(options, parent) {
        this.options = options || {};
        // Internal state that a nested parser receives from its parent. It is deliberately
        // not an option, so that forwarding a caller supplied options object can not seed
        // it and switch the recursion limit off or start the counters over.
        this.rfc822NestingDepth = parent ? parent.rfc822NestingDepth + 1 : 0;
        // Set before the root part is created, since the root is counted and checked too
        this.limits = parent ? parent.limits : parseLimits(this.options);
        this.counters = parent ? parent.counters : { headerSize: 0, partCount: 0, forwardedAddresses: 0 };
        this.root = this.currentNode = new mime_node_js_1.default({ postalMime: this });
        this.boundaries = [];
        this.textContent = {};
        this.textMap = new Map();
        this.textTypes = new Set();
        this.attachments = [];
        this.forceRfc822Attachments = false;
        this.attachmentEncoding = parseAttachmentEncoding(this.options.attachmentEncoding);
        this.started = false;
    }
    /** @internal */
    async finalize() {
        // close all pending nodes
        await this.root.finalize();
    }
    /** @internal */
    async processLine(line, lineBreak, isFinal) {
        let boundaries = this.boundaries;
        // check if this is a mime boundary
        if (boundaries.length && line.length > 2 && line[0] === 0x2d && line[1] === 0x2d) {
            // Could be a boundary marker. The open boundaries are checked outermost first:
            // a boundary may not appear inside the parts it delimits (RFC 2046 5.1.1), and
            // when a nested multipart declares the boundary of an ancestor anyway, or one
            // that ancestor's terminator matches, the ancestor's delimiter is the one every
            // other parser reads the line as. Reading it as the nested one instead gave the
            // nested multipart parts, and an attachment after the ancestor's terminator, that
            // Python and Go leave in the epilogue, which hid it from a scanner built on
            // either while it was shown here. Legal boundaries match one line at most, the
            // order changes nothing for them.
            for (let i = 0; i < boundaries.length; i++) {
                let boundary = boundaries[i];
                // Line must be at least long enough for "--" + boundary
                if (line.length < boundary.value.length + 2) {
                    continue;
                }
                // Check if boundary value matches
                let boundaryMatches = true;
                for (let j = 0; j < boundary.value.length; j++) {
                    if (line[j + 2] !== boundary.value[j]) {
                        boundaryMatches = false;
                        break;
                    }
                }
                if (!boundaryMatches) {
                    continue;
                }
                // Check for terminator (-- after boundary) and determine where boundary ends
                let boundaryEnd = boundary.value.length + 2;
                let isTerminator = false;
                if (line.length >= boundary.value.length + 4 &&
                    line[boundary.value.length + 2] === 0x2d &&
                    line[boundary.value.length + 3] === 0x2d) {
                    isTerminator = true;
                    boundaryEnd = boundary.value.length + 4;
                }
                // RFC 2046: boundary line may have trailing whitespace (space/tab) before CRLF
                let hasValidTrailing = true;
                for (let j = boundaryEnd; j < line.length; j++) {
                    if (!(0, decode_strings_js_1.isWsp)(line[j])) {
                        hasValidTrailing = false;
                        break;
                    }
                }
                if (!hasValidTrailing) {
                    continue;
                }
                if (isTerminator) {
                    await boundary.node.finalize(true);
                    this.currentNode = boundary.node.parentNode || this.root;
                }
                else {
                    // finalize any open child nodes (should be just one though)
                    await boundary.node.finalizeChildNodes(true);
                    this.currentNode = new mime_node_js_1.default({
                        postalMime: this,
                        parentNode: boundary.node,
                        parentMultipartType: boundary.node.contentType.multipart
                    });
                }
                if (isFinal) {
                    return this.finalize();
                }
                return;
            }
        }
        if (this.currentNode.feed(line, lineBreak)) {
            // The headers ended with the line before this one, so the boundary this part
            // declares was not registered when the line was checked above. Read it again
            return this.processLine(line, lineBreak, isFinal);
        }
        if (isFinal) {
            return this.finalize();
        }
    }
    // Reads the next line without its line break. The break itself, the exact bytes between
    // the line and the next one, is returned alongside, because the body decoders write it
    // back out: a part has to keep the line endings it was sent with, see PassThroughDecoder.
    /** @internal */
    readLine() {
        let startPos = this.readPos;
        let endPos = this.readPos;
        while (this.readPos < this.av.length) {
            const c = this.av[this.readPos++];
            if (c !== 0x0d && c !== 0x0a) {
                endPos = this.readPos;
            }
            if (c === 0x0a) {
                return {
                    bytes: new Uint8Array(this.buf, startPos, endPos - startPos),
                    lineBreak: this.av.subarray(endPos, this.readPos),
                    done: this.readPos >= this.av.length
                };
            }
        }
        // A message that ends without a line break still gets one after its last line, the
        // decoders write it out unless a boundary ended the part
        return {
            bytes: new Uint8Array(this.buf, startPos, endPos - startPos),
            lineBreak: LINE_FEED,
            done: this.readPos >= this.av.length
        };
    }
    // Records a text part or a nested message under the node that selects it
    /** @internal */
    addTextEntry(selector, textType, item) {
        let textEntry = this.textMap.get(selector);
        if (!textEntry) {
            textEntry = {};
            this.textMap.set(selector, textEntry);
        }
        const entries = textEntry[textType] || [];
        textEntry[textType] = entries;
        entries.push(item);
        this.textTypes.add(textType);
    }
    // Sorts every leaf of the tree into text content, nested messages and attachments.
    // `alternative` is the closest enclosing multipart/alternative, if any: its text parts
    // are collected under the alternative itself, so that the body is assembled from one
    // representation of it rather than from every one. `related` tells whether the part
    // sits inside a multipart/related, where a Content-ID makes it an inline resource
    /** @internal */
    async collectNode(node, alternative, related) {
        if (!node.contentType.multipart) {
            const inlineRfc822 = this.isInlineMessageRfc822(node);
            const rfc822DepthExceeded = inlineRfc822 && this.rfc822NestingDepth >= this.limits.maxRfc822NestingDepth;
            if (inlineRfc822 && !rfc822DepthExceeded) {
                await this.collectSubMessage(node);
            }
            else if (this.isInlineTextNode(node)) {
                const textType = node.contentType.parsed.value === 'text/html' ? 'html' : 'plain';
                this.addTextEntry(alternative || node, textType, { type: 'text', value: node.getTextContent() });
            }
            else if (node.content) {
                this.collectAttachment(node, node.content, related, rfc822DepthExceeded);
            }
        }
        else if (node.contentType.multipart === 'alternative') {
            alternative = node;
        }
        else if (node.contentType.multipart === 'related') {
            related = true;
        }
        for (let childNode of node.childNodes) {
            await this.collectNode(childNode, alternative, related);
        }
    }
    // Parses an inline message/rfc822 part with a nested parser and takes over its text
    // parts and attachments
    /** @internal */
    async collectSubMessage(node) {
        const subParser = new PostalMime({
            // Options that decide how a part is classified stay with the parser that
            // was configured, the limits and their counters come from this parser.
            // Attachments are encoded by the parent parser, so raw buffers are kept here.
            attachmentEncoding: 'arraybuffer'
        }, this);
        const subMessage = await subParser.parse(node.content || new ArrayBuffer(0));
        // counted before the header block below is rendered into the text and html
        this.counters.forwardedAddresses +=
            countAddresses(subMessage.from) +
                countAddresses(subMessage.to) +
                countAddresses(subMessage.cc) +
                countAddresses(subMessage.bcc);
        if (this.counters.forwardedAddresses > this.limits.maxForwardedAddresses) {
            throw (0, errors_js_1.createError)('EMAXFORWARDEDADDRESSES', `Maximum forwarded address count of ${this.limits.maxForwardedAddresses} addresses exceeded`);
        }
        // The nested parser renders no text, see parse, its text parts are taken over below
        // and rendered by the root parser along with everything else. What it holds of each
        // kind is read off its text types instead of its text and html
        const hasPlain = subParser.textTypes.has('plain');
        const hasHtml = subParser.textTypes.has('html');
        // default to text if there is no content
        if (hasPlain || !hasHtml) {
            this.addTextEntry(node, 'plain', { type: 'subMessage', value: subMessage });
        }
        if (hasHtml) {
            this.addTextEntry(node, 'html', { type: 'subMessage', value: subMessage });
        }
        subParser.textMap.forEach((subTextEntry, subTextNode) => {
            this.textMap.set(subTextNode, subTextEntry);
        });
        for (let attachment of subMessage.attachments) {
            this.attachments.push(attachment);
        }
    }
    /** @internal */
    collectAttachment(node, content, related, rfc822DepthExceeded) {
        const filename = node.contentDisposition.parsed.params.filename || node.contentType.parsed.params.name || null;
        // `content` is filled in below once the part type is known, hence the cast
        const attachment = {
            // An RFC 2231 filename is percent decoded without folding, since the same decoder
            // produces the boundary, so the fold happens here, see foldLineBreaks
            filename: filename ? (0, decode_strings_js_1.decodeWords)((0, decode_strings_js_1.foldLineBreaks)(filename)) : null,
            mimeType: node.contentType.parsed.value,
            disposition: node.contentDisposition.parsed.value || null
        };
        // A nested message that was not parsed is not a renderable inline
        // resource, so it must not join the cid map behind an <img src>.
        if (related && node.contentId && !rfc822DepthExceeded) {
            attachment.related = true;
        }
        if (rfc822DepthExceeded) {
            // Tell the caller this part would have been parsed inline but hit
            // maxRfc822NestingDepth, so anything inside it is not reflected in
            // email.text, email.html or email.attachments.
            attachment.rfc822DepthExceeded = true;
        }
        if (node.contentDescription) {
            // decoded like filename, it is an unstructured header that may
            // carry encoded words
            attachment.description = (0, decode_strings_js_1.decodeWords)(node.contentDescription);
        }
        if (node.contentId) {
            attachment.contentId = node.contentId;
        }
        switch (node.contentType.parsed.value) {
            // Special handling for calendar events
            case 'text/calendar':
            case 'application/ics': {
                if (node.contentType.parsed.params.method) {
                    attachment.method = node.contentType.parsed.params.method.toString().toUpperCase().trim();
                }
                // Enforce into unicode, ending in exactly one newline. The trailing
                // newlines are counted rather than replaced with `/\n*$/`, which
                // retries at every newline of a run that does not end the text.
                const decodedText = node.getTextContent();
                let end = decodedText.length;
                while (end > 0 && decodedText.charCodeAt(end - 1) === 0x0a) {
                    end--;
                }
                attachment.content = decode_strings_js_1.textEncoder.encode(decodedText.slice(0, end) + '\n');
                break;
            }
            // Regular attachments
            default:
                attachment.content = content;
        }
        this.attachments.push(attachment);
    }
    // Joins the collected text parts into the plain and html bodies
    /** @internal */
    renderTextContent() {
        const textContent = {};
        this.textMap.forEach(mapEntry => {
            this.textTypes.forEach(textType => {
                const output = textContent[textType] || [];
                textContent[textType] = output;
                // a node without a part of this type is rendered from the other type
                const ownEntries = mapEntry[textType];
                const entries = ownEntries || mapEntry[textType === 'html' ? 'plain' : 'html'] || [];
                for (const textEntry of entries) {
                    output.push(renderEntry(textEntry, textType, !ownEntries));
                }
            });
        });
        Object.keys(textContent).forEach(textType => {
            this.textContent[textType] = textContent[textType].join('\n');
        });
    }
    /** @internal */
    isInlineTextNode(node) {
        if (node.contentDisposition.parsed.value === 'attachment') {
            // no matter the type, this is an attachment
            return false;
        }
        switch (node.contentType.parsed.value) {
            case 'text/html':
            case 'text/plain':
                return true;
            case 'text/calendar':
            case 'text/csv':
            default:
                return false;
        }
    }
    /** @internal */
    isInlineMessageRfc822(node) {
        if (this.forceRfc822Attachments || node.contentType.parsed.value !== 'message/rfc822') {
            return false;
        }
        // RFC 2046 5.2.1 allows no encoding but 7bit, 8bit and binary for a message/rfc822
        // body. Python parses the lines of a base64 or quoted-printable part as they are, so
        // the nested message it sees has no headers and holds the encoded text, and
        // mailparser keeps the part as one attachment. Decoding and inlining it here
        // rendered the html and listed the attachments of a message no scanner built on
        // either reads, so such a part is an attachment, with its content decoded
        const encoding = node.contentTransferEncoding.encoding;
        if (encoding === 'base64' || encoding === 'quoted-printable') {
            return false;
        }
        let disposition = node.contentDisposition.parsed.value || (this.options.rfc822Attachments ? 'attachment' : 'inline');
        return disposition === 'inline';
    }
    // A delivery status or feedback report carries the offending message as a part. It is
    // evidence rather than content, so it is not inlined into the body of the report
    /** @internal */
    hasReportParts() {
        let found = false;
        let walk = (node) => {
            if (!node.contentType.multipart) {
                if (['message/delivery-status', 'message/feedback-report'].includes(node.contentType.parsed.value)) {
                    found = true;
                }
            }
            for (let childNode of node.childNodes) {
                walk(childNode);
            }
        };
        walk(this.root);
        return found;
    }
    /** @internal */
    async resolveStream(stream) {
        let chunkLen = 0;
        let chunks = [];
        const reader = stream.getReader();
        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }
            // A chunk that is not a byte view, eg. a string from a text stream, used to be
            // copied in as zeros
            if (!ArrayBuffer.isView(value)) {
                const error = (0, errors_js_1.createError)('EINVALIDINPUT', 'Stream chunks must be Uint8Array values');
                // Not awaited, a source that fails or stalls on cancel must not hide this error
                reader.cancel(error).catch(() => { });
                throw error;
            }
            chunks.push(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
            chunkLen += value.byteLength;
        }
        const result = new Uint8Array(chunkLen);
        let chunkPointer = 0;
        for (let chunk of chunks) {
            result.set(chunk, chunkPointer);
            chunkPointer += chunk.length;
        }
        return result;
    }
    /** @internal */
    async resolveInput(buf) {
        let input = buf;
        // Check if the input is a readable stream and resolve it into an ArrayBuffer
        if (isReadableStream(input)) {
            input = await this.resolveStream(input);
        }
        // Should it throw for an empty value instead of defaulting to an empty ArrayBuffer?
        input = input || new ArrayBuffer(0);
        // Cast string input to Uint8Array
        if (typeof input === 'string') {
            input = decode_strings_js_1.textEncoder.encode(input);
        }
        // Cast Blob to ArrayBuffer
        if (isBlob(input)) {
            input = await (0, decode_strings_js_1.blobToArrayBuffer)(input);
        }
        // Cast a Node.js Buffer, a typed array or a DataView into an ArrayBuffer.
        // `new Uint8Array(view)` only works for array-likes, so a DataView produced an
        // empty buffer and the message parsed to nothing without an error. Slicing off
        // byteOffset also keeps views over a larger buffer from reading their neighbours.
        if (ArrayBuffer.isView(input)) {
            return input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
        }
        // Anything else, eg. a number or a plain object, was handed to the Uint8Array
        // constructor as it is and parsed into an empty or zero filled message
        if (!isArrayBuffer(input)) {
            throw (0, errors_js_1.createError)('EINVALIDINPUT', 'Unsupported email input type');
        }
        return input;
    }
    // Properties are added in the order the output has always had them, so the required
    // ones are filled in below rather than in the literal
    /** @internal */
    buildMessage() {
        const headers = this.root.headers;
        const message = {
            headers: headers.map(entry => ({
                key: entry.key,
                originalKey: entry.originalKey,
                value: entry.value
            }))
        };
        for (const key of ['from', 'sender']) {
            const addressHeader = headers.find(line => line.key === key);
            if (addressHeader && addressHeader.value) {
                const addresses = (0, address_parser_js_1.default)(addressHeader.value);
                if (addresses && addresses.length) {
                    message[key] = addresses[0];
                }
            }
        }
        for (const [key, camelKey] of [
            ['delivered-to', 'deliveredTo'],
            ['return-path', 'returnPath']
        ]) {
            const addressHeader = headers.find(line => line.key === key);
            if (addressHeader && addressHeader.value) {
                const addresses = (0, address_parser_js_1.default)(addressHeader.value);
                if (addresses && addresses.length && addresses[0].address) {
                    message[camelKey] = addresses[0].address;
                }
            }
        }
        for (const [key, camelKey] of [
            ['to', 'to'],
            ['cc', 'cc'],
            ['bcc', 'bcc'],
            ['reply-to', 'replyTo']
        ]) {
            // Appended in place, concat() copies the whole list for every header
            const addresses = [];
            for (const entry of headers) {
                if (entry.key === key && entry.value) {
                    for (const address of (0, address_parser_js_1.default)(entry.value)) {
                        addresses.push(address);
                    }
                }
            }
            if (addresses.length) {
                message[camelKey] = addresses;
            }
        }
        for (const [key, camelKey] of [
            ['subject', 'subject'],
            ['message-id', 'messageId'],
            ['in-reply-to', 'inReplyTo'],
            ['references', 'references']
        ]) {
            const header = headers.find(line => line.key === key);
            if (header && header.value) {
                message[camelKey] = (0, decode_strings_js_1.decodeWords)(header.value);
            }
        }
        let dateHeader = headers.find(line => line.key === 'date');
        if (dateHeader) {
            let date = new Date(dateHeader.value);
            // enforce ISO format if seems to be a valid date
            message.date = date.toString() === 'Invalid Date' ? dateHeader.value : date.toISOString();
        }
        const otp = (0, otp_token_js_1.getOtp)(headers);
        if (otp) {
            message.otp = otp;
        }
        if (this.textContent.html) {
            message.html = this.textContent.html;
        }
        if (this.textContent.plain) {
            message.text = this.textContent.plain;
        }
        message.attachments = this.attachments;
        // Expose raw header lines, in the same order as the headers array
        message.headerLines = this.root.rawHeaderLines.slice();
        return message;
    }
    // Every attachment holds binary content at this point, since nested parsers are
    // created with the arraybuffer encoding. The string check narrows the public content
    // type rather than handling a reachable case
    /** @internal */
    encodeAttachments() {
        switch (this.attachmentEncoding) {
            case 'arraybuffer':
                break;
            case 'base64':
                for (let attachment of this.attachments) {
                    if (attachment.content && typeof attachment.content !== 'string') {
                        attachment.content = (0, base64_encoder_js_1.base64ArrayBuffer)(attachment.content);
                        attachment.encoding = 'base64';
                    }
                }
                break;
            case 'utf8': {
                let attachmentDecoder = new TextDecoder('utf8');
                for (let attachment of this.attachments) {
                    if (attachment.content && typeof attachment.content !== 'string') {
                        attachment.content = attachmentDecoder.decode(attachment.content);
                        attachment.encoding = 'utf8';
                    }
                }
                break;
            }
        }
    }
    /**
     * Parses a raw email message. A parser instance can be used once
     *
     * @param buf Raw email message
     * @returns The parsed email
     */
    async parse(buf) {
        if (this.started) {
            throw (0, errors_js_1.createError)('EPARSERREUSED', 'Can not reuse parser, create a new PostalMime object');
        }
        this.started = true;
        this.buf = await this.resolveInput(buf);
        this.av = new Uint8Array(this.buf);
        this.readPos = 0;
        while (this.readPos < this.av.length) {
            const line = this.readLine();
            await this.processLine(line.bytes, line.lineBreak, line.done);
        }
        this.forceRfc822Attachments = Boolean(this.options.forceRfc822Attachments) || this.hasReportParts();
        await this.collectNode(this.root, false, false);
        // A nested parser hands its text parts to its parent, see collectSubMessage, and the
        // root parser renders them all at once. Rendering at every level as well cost each
        // level the text and html of everything below it, and kept them until the root was
        // done: a chain of forwards as deep as maxRfc822NestingDepth allows took ten times
        // the time and the memory of the flat message it held
        if (this.rfc822NestingDepth === 0) {
            this.renderTextContent();
        }
        const message = this.buildMessage();
        this.encodeAttachments();
        return message;
    }
}
exports.default = PostalMime;
for (const key of Object.keys(exports)) {
    if (key !== "default") {
        exports.default[key] = exports[key];
    }
}
Object.defineProperty(exports.default, '__esModule', { value: true });
Object.defineProperty(exports.default, 'default', { value: exports.default, enumerable: false, writable: true, configurable: true });
module.exports = exports.default;
//# sourceMappingURL=postal-mime.js.map
},
"./qp-decoder.js":function(module,exports,require){
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const decode_strings_js_1 = require("./decode-strings.js");
const chunk_writer_js_1 = __importDefault(require("./chunk-writer.js"));
const CHR_EQUALS = 0x3d;
class QPDecoder {
    constructor() {
        this.output = new chunk_writer_js_1.default();
        this.pendingLineBreak = null;
    }
    writeLineBreak() {
        if (this.pendingLineBreak) {
            this.output.writeBytes(this.pendingLineBreak);
        }
    }
    // Quoted-printable source is 7 bit by definition, so it is decoded byte by byte and
    // the result is handed on as bytes. Running the body charset over the encoded source
    // instead corrupted every part whose charset was not ASCII compatible: the same
    // content that decoded correctly in base64 came out as mojibake in quoted-printable.
    //
    // As in PassThroughDecoder, a hard line break is only written once the next line
    // arrives, so the CRLF that belongs to a following boundary is not decoded as content,
    // and the break written is the one the line came with.
    update(line, lineBreak) {
        this.writeLineBreak();
        let len = line.length;
        // Trailing white space on an encoded line was added in transit and is deleted (RFC
        // 2045 6.7 rule 3). Before the soft line break is looked for, since the `=` it
        // consists of may have had white space appended the same way
        while (len > 0 && (0, decode_strings_js_1.isWsp)(line[len - 1])) {
            len--;
        }
        // a line ending in '=' is a soft line break, the newline is not part of the content
        const softBreak = len > 0 && line[len - 1] === CHR_EQUALS;
        if (softBreak) {
            len--;
        }
        let literalStart = 0;
        for (let i = 0; i < len; i++) {
            if (line[i] !== CHR_EQUALS || i + 2 >= len) {
                continue;
            }
            const high = (0, decode_strings_js_1.hexNibble)(line[i + 1]);
            const low = (0, decode_strings_js_1.hexNibble)(line[i + 2]);
            if (high < 0 || low < 0) {
                // not a valid escape sequence, keep it as literal text
                continue;
            }
            this.output.writeBytes(line, literalStart, i);
            this.output.writeByte((high << 4) | low);
            i += 2;
            literalStart = i + 1;
        }
        this.output.writeBytes(line, literalStart, len);
        this.pendingLineBreak = softBreak ? null : lineBreak;
    }
    // see PassThroughDecoder.finalize
    finalize(boundaryEnded = false) {
        if (!boundaryEnded) {
            this.writeLineBreak();
        }
        return this.output.finalize();
    }
}
exports.default = QPDecoder;
Object.defineProperty(exports.default, 'default', { value: exports.default, enumerable: false, writable: true, configurable: true });
module.exports = exports.default;
//# sourceMappingURL=qp-decoder.js.map
},
"./text-format.js":function(module,exports,require){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.decodeHTMLEntities = decodeHTMLEntities;
exports.escapeHtml = escapeHtml;
exports.textToHtml = textToHtml;
exports.htmlToText = htmlToText;
exports.formatTextHeader = formatTextHeader;
exports.formatHtmlHeader = formatHtmlHeader;
const html_entities_js_1 = require("./html-entities.js");
const decode_strings_js_1 = require("./decode-strings.js");
// What a numeric character reference to the C1 control range stands for, per the HTML
// numeric character reference end state: the windows-1252 character at that byte. This is
// how Outlook and Word write their curly quotes and dashes (`&#146;`, `&#150;`), and the
// raw control character they decoded to otherwise is invisible in the text.
const C1_ENTITY_REPLACEMENTS = new Map([
    [0x80, 0x20ac],
    [0x82, 0x201a],
    [0x83, 0x0192],
    [0x84, 0x201e],
    [0x85, 0x2026],
    [0x86, 0x2020],
    [0x87, 0x2021],
    [0x88, 0x02c6],
    [0x89, 0x2030],
    [0x8a, 0x0160],
    [0x8b, 0x2039],
    [0x8c, 0x0152],
    [0x8e, 0x017d],
    [0x91, 0x2018],
    [0x92, 0x2019],
    [0x93, 0x201c],
    [0x94, 0x201d],
    [0x95, 0x2022],
    [0x96, 0x2013],
    [0x97, 0x2014],
    [0x98, 0x02dc],
    [0x99, 0x2122],
    [0x9a, 0x0161],
    [0x9b, 0x203a],
    [0x9c, 0x0153],
    [0x9e, 0x017e],
    [0x9f, 0x0178]
]);
function decodeHTMLEntities(str) {
    return str.replace(/&(#\d+|#x[a-f0-9]+|[a-z]+\d*);?/gi, (match, entity) => {
        if (typeof html_entities_js_1.htmlEntities[match] === 'string') {
            return html_entities_js_1.htmlEntities[match];
        }
        if (entity.charAt(0) !== '#' || match.charAt(match.length - 1) !== ';') {
            // keep as is, invalid or unknown sequence
            return match;
        }
        let codePoint;
        // The pattern matches the marker in either case, so the test has to as well. Reading
        // `&#X41;` as decimal gave NaN, which passes every range check below and comes out
        // of String.fromCharCode as a NUL character
        if (entity.charAt(1).toLowerCase() === 'x') {
            codePoint = parseInt(entity.slice(2), 16);
        }
        else {
            codePoint = parseInt(entity.slice(1), 10);
        }
        let output = '';
        // A NUL reference, a surrogate or a code point out of range is a replacement
        // character, like in a browser. A NUL in particular would truncate the text in
        // whatever reads it next
        if (codePoint === 0 || (codePoint >= 0xd800 && codePoint <= 0xdfff) || codePoint > 0x10ffff) {
            return '\ufffd';
        }
        codePoint = C1_ENTITY_REPLACEMENTS.get(codePoint) ?? codePoint;
        if (codePoint > 0xffff) {
            codePoint -= 0x10000;
            output += String.fromCharCode(((codePoint >>> 10) & 0x3ff) | 0xd800);
            codePoint = 0xdc00 | (codePoint & 0x3ff);
        }
        output += String.fromCharCode(codePoint);
        return output;
    });
}
// two uppercase hex digits of a value below 256
const hexByte = (value) => value.toString(16).toUpperCase().padStart(2, '0');
function escapeHtml(str) {
    return str.trim().replace(/[<>"'?&]/g, c => '&#x' + hexByte(c.charCodeAt(0)) + ';');
}
// The characters an address may carry into a mailto URL as they are (RFC 6068 2:
// unreserved and some-delims). Anything else is percent encoded: a `?` or `&` starts the
// header fields of the URL, so `help@bank.example?cc=attacker@evil.example&body=…` given
// as the address of a forwarded message opened a compose window with a Cc and a body the
// sender chose once the link was clicked. Html escaping alone does not help, the browser
// decodes the entities back before it reads the URL
const MAILTO_UNSAFE = /[^A-Za-z0-9\-._~!$'()*+,;:@]+/g;
// the percent encoded form of every byte, so that an encoded run allocates nothing per byte
const PERCENT_ENCODED = Array.from({ length: 256 }, (_, byte) => '%' + hexByte(byte));
// Each unsafe run is encoded whole and the result is built flat by replace. Appended one
// character at a time it was a cons string of a node per character, which escapeHtml then
// flattened: a long address of percent signs in a forwarded header held some sixty bytes
// of heap per byte of it until then
function encodeMailto(address) {
    return address.replace(MAILTO_UNSAFE, run => Array.from(decode_strings_js_1.textEncoder.encode(run), byte => PERCENT_ENCODED[byte]).join(''));
}
function textToHtml(str) {
    let html = escapeHtml(str).replace(/\n/g, '<br />');
    return '<div>' + html + '</div>';
}
// htmlToText strips tags with regexes like `<br\b[^>]*>` and `<!--.*?-->`. Handed to
// String#replace as they are, the engine tries every candidate in turn and a candidate
// that does not close scans on to the next `>` or the end of the input before giving up,
// so an html part holding many unclosed `<`, `<a ` or `<!--` took seconds to minutes to
// convert. The helpers below give the same results in linear time. They run on text
// without line terminators, see htmlToText, so `.` matches every character of it.
/**
 * Returns a function that finds the next match of a global regex at or after a position.
 *
 * Callers only ever ask about positions that move forward, so a match stays the answer
 * until a position passes it, and no match stays the answer for good. That way every part
 * of the string is scanned once, however many times it is asked about.
 *
 * @param str String to search
 * @param regex Global regex to look for
 * @return `pos => match` of the next match, or null if there is none
 */
function createFinder(str, regex) {
    let searchedFrom = Infinity;
    let found = null;
    return pos => {
        if (pos < searchedFrom || (found && pos > found.index)) {
            regex.lastIndex = pos;
            found = regex.exec(str);
            searchedFrom = pos;
        }
        return found;
    };
}
/**
 * Runs `process` on the text up to and including the last `>` and appends the rest as is,
 * for a pass whose every match ends at a `>`. The text after the last `>` can never match
 * and is where a failing pattern rescans to the end from each candidate.
 *
 * @param str String to process
 * @param process The pass to run
 * @return Processed string
 */
function throughLastTag(str, process) {
    const end = str.lastIndexOf('>') + 1;
    return process(str.slice(0, end)) + str.slice(end);
}
/**
 * `str.replace(pattern, replacement)` for a pattern shaped like `<tag\b[^>]*>`.
 *
 * Such a pattern only fails at a candidate that has no `>` after it, so the text after
 * the last `>` can never match and is where every rescan happened. Leaving it out keeps
 * the native replace, and its speed, for everything else.
 *
 * @param str String to process
 * @param pattern Global regex that ends on the first `>` after its start
 * @param replacement Replacement text
 * @return Processed string
 */
function replaceClosedTags(str, pattern, replacement) {
    return throughLastTag(str, head => head.replace(pattern, replacement));
}
/**
 * `str.replace(pattern, replacement)` for a tag pattern that may fail even when a `>`
 * follows, like `<a\b[^>]*href...>`, or that runs on past its `>`.
 *
 * A candidate with no `>` after it ends the search, since no later candidate can close
 * either. A candidate that does not match skips every other candidate before the same
 * `>`, since those see the same tag body and fail the same way.
 *
 * @param str String to process
 * @param prefix Global regex for the start of a candidate, which can not contain `>`
 * @param pattern The whole pattern as a sticky regex
 * @param replacement Function given the match and its groups
 * @return Processed string
 */
function replaceTags(str, prefix, pattern, replacement) {
    const parts = [];
    // everything before this index is already in parts
    let copied = 0;
    let searchFrom = 0;
    while (true) {
        prefix.lastIndex = searchFrom;
        const candidate = prefix.exec(str);
        if (!candidate) {
            break;
        }
        const start = candidate.index;
        // Looked up before the pattern runs. The engine finds out on its own that there is
        // no `>` to close on, but only after it has retried the tail of the pattern at every
        // `href` in the rest of the input and rescanned to the end each time, which made an
        // html part of many unclosed `<a href` tags quadratic to convert
        const gt = str.indexOf('>', start);
        if (gt < 0) {
            break;
        }
        pattern.lastIndex = start;
        const match = pattern.exec(str);
        if (!match) {
            searchFrom = gt + 1;
            continue;
        }
        parts.push(str.slice(copied, start), replacement(...match));
        copied = searchFrom = start + match[0].length;
    }
    parts.push(str.slice(copied));
    return parts.join('');
}
/**
 * `str.replace(pattern, replacement)` for a pattern like `<!--.*?-->` or
 * `<script\b[^>]*>.*?<\/script\b[^>]*>`, ie. an opener and a closer, either of which may
 * continue with `[^>]*>`, and a lazy `.*?` between them. The engine rescans to the end of
 * the input for every opener that is not closed.
 *
 * @param str String to process
 * @param open Global regex for the opener
 * @param openToGt Whether the opener continues with `[^>]*>`
 * @param close Global regex for the closer
 * @param closeToGt Whether the closer continues with `[^>]*>`
 * @param replacement Replacement text
 * @return Processed string
 */
function replaceBlocks(str, open, openToGt, close, closeToGt, replacement) {
    const nextGt = createFinder(str, />/g);
    const nextClose = createFinder(str, close);
    const parts = [];
    let copied = 0;
    let searchFrom = 0;
    while (true) {
        open.lastIndex = searchFrom;
        const opener = open.exec(str);
        if (!opener) {
            break;
        }
        const start = opener.index;
        searchFrom = start + 1;
        // where the lazy `.*?` starts
        let from = start + opener[0].length;
        if (openToGt) {
            const gt = nextGt(from);
            if (!gt) {
                // neither this opener nor any later one can close
                break;
            }
            from = gt.index + 1;
        }
        const closer = nextClose(from);
        if (!closer) {
            // no closer follows this opener, so none follows a later one either
            break;
        }
        let end = closer.index + closer[0].length;
        if (closeToGt) {
            const gt = nextGt(end);
            if (!gt) {
                // this is the first closer after the opener, and any other one comes
                // later, so none of them is followed by `>`
                break;
            }
            end = gt.index + 1;
        }
        parts.push(str.slice(copied, start), replacement);
        copied = searchFrom = end;
    }
    parts.push(str.slice(copied));
    return parts.join('');
}
/**
 * `str.replace(pattern, '')` for `^.*<tag\b[^>]*>`, ie. drops everything up to and
 * including the last such tag.
 *
 * @param str String to process
 * @param prefix Global regex for the start of the tag, which can not contain `>`
 * @return Processed string
 */
function stripThroughLastTag(str, prefix) {
    // `[^>]*>` needs a `>` after the tag
    const limit = str.lastIndexOf('>');
    let last = -1;
    prefix.lastIndex = 0;
    let match;
    while ((match = prefix.exec(str)) && match.index < limit) {
        last = match.index;
    }
    return last < 0 ? str : str.slice(str.indexOf('>', last) + 1);
}
/**
 * `str.replace(pattern, '')` for `<tag\b[^>]*>.*$`, ie. drops the first such tag that is
 * closed, and everything after it.
 *
 * @param str String to process
 * @param prefix Global regex for the start of the tag, which can not contain `>`
 * @return Processed string
 */
function stripFromFirstTag(str, prefix) {
    prefix.lastIndex = 0;
    const match = prefix.exec(str);
    return match && match.index < str.lastIndexOf('>') ? str.slice(0, match.index) : str;
}
function htmlToText(str) {
    // Tags are not processed across lines, so every line terminator, every character `.`
    // does not match, becomes a placeholder first. Only `\r?\n` used to, and the patterns
    // below do not cross the others either: `.*?` stops at a bare CR or a U+2028, so a
    // script whose body held one was not removed as a block, its tags were stripped as
    // tags and the script itself landed in the text, which a filter reading the text then
    // took for content
    str = str.replace(/\r\n|[\n\r\u2028\u2029]/g, '\u0001');
    str = replaceBlocks(str, /<!--/g, false, /-->/g, false, ' ');
    str = replaceClosedTags(str, /<br\b[^>]*>/gi, '\n');
    str = replaceClosedTags(str, /<\/?(p|div|table|tr|td|th)\b[^>]*>/gi, '\n\n');
    str = replaceBlocks(str, /<script\b/gi, true, /<\/script\b/gi, true, ' ');
    // a stylesheet in the body is no text of the message either
    str = replaceBlocks(str, /<style\b/gi, true, /<\/style\b/gi, true, ' ');
    str = stripThroughLastTag(str, /<body\b/gi);
    str = stripThroughLastTag(str, /<\/head\b/gi);
    str = stripThroughLastTag(str, /<!doctype\b/gi);
    str = stripFromFirstTag(str, /<\/body\b/gi);
    str = stripFromFirstTag(str, /<\/html\b/gi);
    // The href capture also matches `>`, so after a link a run with no whitespace or quote
    // is taken to the end of the input and given back one character at a time, retrying
    // `[^>]*>` to the end from each, which is quadratic when no `>` follows
    str = throughLastTag(str, head => replaceTags(head, /<a\b/gi, /<a\b[^>]*href\s*=\s*["']?([^\s"']+)[^>]*>/iy, (match, href) => ` (${href}) `));
    str = replaceClosedTags(str, /<\/?(span|em|i|strong|b|u|a)\b[^>]*>/gi, '');
    // the whitespace after the tag may run on past the last `>`
    str = replaceTags(str, /<li\b/gi, /<li\b[^>]*>[\n\u0001\s]*/iy, () => '* ');
    str = replaceClosedTags(str, /<hr\b[^>]*>/g, '\n-------------\n');
    str = replaceClosedTags(str, /<[^>]*>/g, ' ');
    str = str
        // convert linebreak placeholders back to newlines
        .replace(/\u0001/g, '\n')
        .replace(/[ \t]+/g, ' ')
        .replace(/^\s+$/gm, '')
        .replace(/\n\n+/g, '\n\n')
        .replace(/^\n+/, '\n')
        .replace(/\n+$/, '\n');
    str = decodeHTMLEntities(str);
    return str;
}
// The formatter the dates of forwarded headers are rendered with, created on first use.
// One instance serves every date, a formatter is immutable. Constructing one per rendered
// header held some 30 KB of ICU state outside the V8 heap for each, so a message of a few
// thousand dated forwards took hundreds of megabytes that no heap limit saw, and several
// times the time of the same message without the dates
let dateFormatter = null;
// A message date is not always a date. PostalMime keeps the raw header value when it does
// not parse, and Intl.DateTimeFormat throws a RangeError on that, which used to reject the
// whole parse of any message carrying a forwarded copy with a broken Date header.
function formatDate(date) {
    if (typeof Intl === 'undefined') {
        return date;
    }
    const parsed = new Date(date);
    if (isNaN(parsed.getTime())) {
        return date;
    }
    dateFormatter ??= new Intl.DateTimeFormat('default', {
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
        hour12: false
    });
    return dateFormatter.format(parsed);
}
function formatTextAddress(address) {
    return (address.name ? [address.name, `<${address.address}>`] : [address.address]).join(' ');
}
function formatTextAddresses(addresses) {
    let parts = [];
    let processAddress = (address, partCounter) => {
        if (partCounter) {
            parts.push(', ');
        }
        if (address.group) {
            let groupStart = `${address.name}:`;
            let groupEnd = `;`;
            parts.push(groupStart);
            address.group.forEach(processAddress);
            parts.push(groupEnd);
        }
        else {
            parts.push(formatTextAddress(address));
        }
    };
    addresses.forEach(processAddress);
    return parts.join('');
}
function formatHtmlAddress(address) {
    return `<a href="mailto:${escapeHtml(encodeMailto(address.address))}" class="postal-email-address">${escapeHtml(address.name || `<${address.address}>`)}</a>`;
}
function formatHtmlAddresses(addresses) {
    let parts = [];
    let processAddress = (address, partCounter) => {
        if (partCounter) {
            parts.push('<span class="postal-email-address-separator">, </span>');
        }
        if (address.group) {
            let groupStart = `<span class="postal-email-address-group">${escapeHtml(address.name)}:</span>`;
            let groupEnd = `<span class="postal-email-address-group">;</span>`;
            parts.push(groupStart);
            address.group.forEach(processAddress);
            parts.push(groupEnd);
        }
        else {
            parts.push(formatHtmlAddress(address));
        }
    };
    addresses.forEach(processAddress);
    return parts.join(' ');
}
function foldLines(str, lineLength, afterSpace) {
    str = (str || '').toString();
    lineLength = lineLength || 76;
    let pos = 0, len = str.length, result = '', line, match;
    while (pos < len) {
        line = str.slice(pos, pos + lineLength);
        if (line.length < lineLength) {
            result += line;
            break;
        }
        if ((match = line.match(/^[^\n\r]*(\r?\n|\r)/))) {
            line = match[0];
            result += line;
            pos += line.length;
            continue;
        }
        else if ((match = line.match(/(\s+)[^\s]*$/)) &&
            match[0].length - (afterSpace ? (match[1] || '').length : 0) < line.length) {
            line = line.slice(0, line.length - (match[0].length - (afterSpace ? (match[1] || '').length : 0)));
        }
        else if ((match = str.slice(pos + line.length).match(/^[^\s]+(\s*)/))) {
            line = line + match[0].slice(0, match[0].length - (!afterSpace ? (match[1] || '').length : 0));
        }
        result += line;
        pos += line.length;
        if (pos < len) {
            result += '\r\n';
        }
    }
    return result;
}
function formatTextHeader(message) {
    let rows = [];
    if (message.from) {
        // through the plural formatter, because `From:` may hold RFC 5322 group syntax
        // and a group has no address of its own
        rows.push({ key: 'From', val: formatTextAddresses([message.from]) });
    }
    if (message.subject) {
        rows.push({ key: 'Subject', val: message.subject });
    }
    if (message.date) {
        rows.push({ key: 'Date', val: formatDate(message.date) });
    }
    if (message.to && message.to.length) {
        rows.push({ key: 'To', val: formatTextAddresses(message.to) });
    }
    if (message.cc && message.cc.length) {
        rows.push({ key: 'Cc', val: formatTextAddresses(message.cc) });
    }
    if (message.bcc && message.bcc.length) {
        rows.push({ key: 'Bcc', val: formatTextAddresses(message.bcc) });
    }
    // Align keys and values by adding space between these two
    // Also make sure that the separator line is as long as the longest line
    // Should end up with something like this:
    /*
    -----------------------------
    From:    xx xx <xxx@xxx.com>
    Subject: Example Subject
    Date:    16/02/2021, 02:57:06
    To:      not@found.com
    -----------------------------
    */
    let maxKeyLength = rows
        .map(r => r.key.length)
        .reduce((acc, cur) => {
        return cur > acc ? cur : acc;
    }, 0);
    const lines = rows.flatMap(row => {
        let sepLen = maxKeyLength - row.key.length;
        let prefix = `${row.key}: ${' '.repeat(sepLen)}`;
        let emptyPrefix = `${' '.repeat(row.key.length + 1)} ${' '.repeat(sepLen)}`;
        let foldedLines = foldLines(row.val, 80, true)
            .split(/\r?\n/)
            .map(line => line.trim());
        return foldedLines.map((line, i) => `${i ? emptyPrefix : prefix}${line}`);
    });
    let maxLineLength = lines
        .map(r => r.length)
        .reduce((acc, cur) => {
        return cur > acc ? cur : acc;
    }, 0);
    let lineMarker = '-'.repeat(maxLineLength);
    let template = `
${lineMarker}
${lines.join('\n')}
${lineMarker}
`;
    return template;
}
function formatHtmlHeader(message) {
    let rows = [];
    if (message.from) {
        rows.push(
        // through the plural formatter, because `From:` may hold RFC 5322 group syntax
        // and a group has no address of its own
        `<div class="postal-email-header-key">From</div><div class="postal-email-header-value">${formatHtmlAddresses([message.from])}</div>`);
    }
    if (message.subject) {
        rows.push(`<div class="postal-email-header-key">Subject</div><div class="postal-email-header-value postal-email-header-subject">${escapeHtml(message.subject)}</div>`);
    }
    if (message.date) {
        rows.push(`<div class="postal-email-header-key">Date</div><div class="postal-email-header-value postal-email-header-date" data-date="${escapeHtml(message.date)}">${escapeHtml(formatDate(message.date))}</div>`);
    }
    if (message.to && message.to.length) {
        rows.push(`<div class="postal-email-header-key">To</div><div class="postal-email-header-value">${formatHtmlAddresses(message.to)}</div>`);
    }
    if (message.cc && message.cc.length) {
        rows.push(`<div class="postal-email-header-key">Cc</div><div class="postal-email-header-value">${formatHtmlAddresses(message.cc)}</div>`);
    }
    if (message.bcc && message.bcc.length) {
        rows.push(`<div class="postal-email-header-key">Bcc</div><div class="postal-email-header-value">${formatHtmlAddresses(message.bcc)}</div>`);
    }
    let template = `<div class="postal-email-header">${rows.length ? '<div class="postal-email-header-row">' : ''}${rows.join('</div>\n<div class="postal-email-header-row">')}${rows.length ? '</div>' : ''}</div>`;
    return template;
}
//# sourceMappingURL=text-format.js.map
},
"./types.js":function(module,exports,require){
"use strict";
// The public types of the package. They are type aliases rather than interfaces on
// purpose: an alias has an implicit index signature, so a parsed message stays
// assignable to `Record<string, unknown>`, which is how consumers hand it to loggers and
// storage helpers, and every optional property is declared as `T | undefined` so that the
// types also work under exactOptionalPropertyTypes. test/package-test.ts checks both.
Object.defineProperty(exports, "__esModule", { value: true });
//# sourceMappingURL=types.js.map
}};const cache={};function require(id){if(cache[id])return cache[id].exports;const m={exports:{}};cache[id]=m;modules[id](m,m.exports,require);return m.exports;}const p=require('./postal-mime.js');g.PostalMime=p.default;g.decodeWords=p.decodeWords;})(globalThis);
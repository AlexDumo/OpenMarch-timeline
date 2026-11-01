/**
 * ESLint rules behind `pnpm check:i18n`. They run only from `check-i18n.mjs`, not from the
 * repository's ESLint config, so the opt-out is an `i18n-ignore` comment rather than an
 * `eslint-disable` directive.
 */

const LETTER = /\p{L}/u;

/** Props whose string value is shown to the user or read out by a screen reader. */
const TEXT_PROP =
    /^(title|alt|label|placeholder|tooltip|description|heading|subtitle|message)$|^aria-(label|description|valuetext|roledescription)$|[a-z](Label|Text|Title|Tooltip|Description|Message)$/;

/** Elements whose text is code or markup, not prose. */
const NON_PROSE_ELEMENTS = new Set(["code", "pre", "style", "script"]);

/** Calls whose first argument is a message shown to the user. */
const MESSAGE_CALLS = new Set(["conToastError", "alert", "confirm"]);

const IGNORE_MARKER = "i18n-ignore";

const hasLetter = (text) => LETTER.test(text);

/** The string literals in an expression that would reach the screen as written. */
function literalText(node) {
    if (!node) return [];
    switch (node.type) {
        case "Literal":
            return typeof node.value === "string" && hasLetter(node.value)
                ? [node]
                : [];
        case "TemplateLiteral":
            return node.quasis.some((quasi) =>
                hasLetter(quasi.value.cooked ?? quasi.value.raw),
            )
                ? [node]
                : [];
        case "ConditionalExpression":
            return [
                ...literalText(node.consequent),
                ...literalText(node.alternate),
            ];
        case "LogicalExpression":
            return node.operator === "&&"
                ? literalText(node.right)
                : [...literalText(node.left), ...literalText(node.right)];
        case "JSXExpressionContainer":
            return literalText(node.expression);
        case "TSAsExpression":
        case "TSSatisfiesExpression":
            return literalText(node.expression);
        default:
            return [];
    }
}

function elementName(node) {
    const name = node?.openingElement?.name;
    return name?.type === "JSXIdentifier" ? name.name : undefined;
}

function calleeName(callee) {
    if (callee.type === "Identifier") return callee.name;
    if (
        callee.type === "MemberExpression" &&
        callee.object.type === "Identifier" &&
        callee.property.type === "Identifier"
    ) {
        return `${callee.object.name}.${callee.property.name}`;
    }
    return undefined;
}

function isMessageCall(name) {
    if (!name) return false;
    return (
        name === "toast" ||
        name.startsWith("toast.") ||
        MESSAGE_CALLS.has(name) ||
        name === "window.alert" ||
        name === "window.confirm"
    );
}

/** Lines covered by an `i18n-ignore` comment: the comment's own last line and the next. */
function ignoredLines(sourceCode) {
    const lines = new Set();
    for (const comment of sourceCode.getAllComments()) {
        if (!comment.value.includes(IGNORE_MARKER)) continue;
        lines.add(comment.loc.end.line);
        lines.add(comment.loc.end.line + 1);
    }
    return lines;
}

export const noUntranslatedText = {
    meta: {
        type: "problem",
        messages: {
            text: "Untranslated UI text: {{text}}",
        },
        schema: [],
    },
    create(context) {
        const sourceCode = context.sourceCode ?? context.getSourceCode();
        const ignored = ignoredLines(sourceCode);

        const report = (node) => {
            if (ignored.has(node.loc.start.line)) return;
            const raw = sourceCode.getText(node).trim().replace(/\s+/g, " ");
            const text = raw.length > 60 ? `${raw.slice(0, 57)}...` : raw;
            context.report({ node, messageId: "text", data: { text } });
        };

        return {
            JSXText(node) {
                if (!hasLetter(node.value)) return;
                if (NON_PROSE_ELEMENTS.has(elementName(node.parent))) return;
                report(node);
            },
            JSXExpressionContainer(node) {
                const parent = node.parent;
                if (
                    parent.type !== "JSXElement" &&
                    parent.type !== "JSXFragment"
                )
                    return;
                if (NON_PROSE_ELEMENTS.has(elementName(parent))) return;
                literalText(node.expression).forEach(report);
            },
            JSXAttribute(node) {
                if (node.name.type !== "JSXIdentifier") return;
                if (!TEXT_PROP.test(node.name.name)) return;
                literalText(node.value).forEach(report);
            },
            CallExpression(node) {
                if (!isMessageCall(calleeName(node.callee))) return;
                literalText(node.arguments[0]).forEach(report);
            },
        };
    },
};

/** The literal key and inline default of a Tolgee `t(...)` call or `<T keyName>`. */
function translationCall(node) {
    const callee = node.callee;
    const isT =
        (callee.type === "Identifier" && callee.name === "t") ||
        (callee.type === "MemberExpression" &&
            !callee.computed &&
            callee.property.type === "Identifier" &&
            callee.property.name === "t");
    if (!isT) return undefined;
    const [first, second] = node.arguments;
    if (first?.type === "Literal" && typeof first.value === "string") {
        const fallback =
            second?.type === "Literal" && typeof second.value === "string"
                ? second.value
                : objectString(second, "defaultValue");
        return { keyNode: first, key: first.value, fallback };
    }
    if (first?.type === "ObjectExpression") {
        const keyNode = objectProperty(first, "key");
        if (keyNode?.type === "Literal" && typeof keyNode.value === "string") {
            return {
                keyNode,
                key: keyNode.value,
                fallback: objectString(first, "defaultValue"),
            };
        }
    }
    return undefined;
}

function objectProperty(node, name) {
    if (node?.type !== "ObjectExpression") return undefined;
    const property = node.properties.find(
        (p) =>
            p.type === "Property" &&
            !p.computed &&
            ((p.key.type === "Identifier" && p.key.name === name) ||
                (p.key.type === "Literal" && p.key.value === name)),
    );
    return property?.value;
}

function objectString(node, name) {
    const value = objectProperty(node, name);
    return value?.type === "Literal" && typeof value.value === "string"
        ? value.value
        : undefined;
}

function jsxAttribute(opening, name) {
    return opening.attributes.find(
        (a) =>
            a.type === "JSXAttribute" &&
            a.name.type === "JSXIdentifier" &&
            a.name.name === name,
    );
}

function jsxString(attribute) {
    const value = attribute?.value;
    if (value?.type === "Literal" && typeof value.value === "string")
        return { node: value, value: value.value };
    if (
        value?.type === "JSXExpressionContainer" &&
        value.expression.type === "Literal" &&
        typeof value.expression.value === "string"
    )
        return { node: value.expression, value: value.expression.value };
    return undefined;
}

/**
 * Every literal key passed to Tolgee exists in `en.json`, and an inline default matches the
 * English there. Option: `{ english: Record<flatKey, string> }`.
 */
export const knownTranslationKey = {
    meta: {
        type: "problem",
        messages: {
            missing:
                'Key "{{key}}" is not in i18n/en.json, so translators never see it. Add it with its English text.',
            drift: `The inline default for "{{key}}" differs from i18n/en.json ("{{english}}"). Change both together.`,
        },
        schema: [{ type: "object" }],
    },
    create(context) {
        const english = context.options[0]?.english ?? {};

        const check = (keyNode, key, fallback) => {
            if (!(key in english)) {
                context.report({
                    node: keyNode,
                    messageId: "missing",
                    data: { key },
                });
            } else if (fallback !== undefined && fallback !== english[key]) {
                context.report({
                    node: keyNode,
                    messageId: "drift",
                    data: { key, english: english[key] },
                });
            }
        };

        return {
            CallExpression(node) {
                const call = translationCall(node);
                if (call) check(call.keyNode, call.key, call.fallback);
            },
            JSXOpeningElement(node) {
                if (
                    node.name.type !== "JSXIdentifier" ||
                    node.name.name !== "T"
                )
                    return;
                const key = jsxString(jsxAttribute(node, "keyName"));
                if (!key) return;
                const fallback = jsxString(jsxAttribute(node, "defaultValue"));
                check(key.node, key.value, fallback?.value);
            },
        };
    },
};

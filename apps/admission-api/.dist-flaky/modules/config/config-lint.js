"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.lintConfig = lintConfig;
const ajv_1 = __importDefault(require("ajv"));
const ajv_formats_1 = __importDefault(require("ajv-formats"));
const contracts_1 = require("@wonseoro/contracts");
const form_schema_service_1 = require("./form-schema.service");
/** application_field_value.field_code varchar(128). 경로·특수문자를 막는다. */
const FIELD_CODE = /^[A-Za-z][A-Za-z0-9_]{0,127}$/;
/** document.document_type varchar(64). */
const DOCUMENT_TYPE = /^[A-Z][A-Z0-9_]{0,63}$/;
function isObject(v) {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}
/**
 * @param typeCodes 이 모집 주기의 전형 코드. 모르면 null — 그때는 전형 코드 대조를 건너뛴다.
 */
function lintConfig(config, typeCodes) {
    const errors = [];
    const warnings = [];
    if (!isObject(config))
        return { errors: ['설정은 JSON 객체여야 합니다.'], warnings };
    const known = typeCodes ? new Set(typeCodes) : null;
    const unknownType = (where, code) => {
        if (known && !known.has(code))
            warnings.push(`${where}.${code}: 이 모집에 없는 전형 코드입니다.`);
    };
    // ── forms ───────────────────────────────────────────────────────────
    if (config.forms !== undefined) {
        if (!isObject(config.forms)) {
            errors.push('forms 는 전형 코드별 JSON Schema 객체여야 합니다.');
        }
        else {
            // 런타임(FormSchemaService)과 같은 옵션으로 컴파일한다. 다른 옵션이면 여기서 통과하고 런타임에서 깨진다.
            const ajv = new ajv_1.default({ allErrors: true, strict: false, coerceTypes: false });
            (0, ajv_formats_1.default)(ajv);
            for (const [code, form] of Object.entries(config.forms)) {
                const at = `forms.${code}`;
                unknownType('forms', code);
                if (!isObject(form)) {
                    errors.push(`${at}: JSON Schema 객체여야 합니다.`);
                    continue;
                }
                if (form.type !== undefined && form.type !== 'object') {
                    errors.push(`${at}.type: 원서 양식은 object 여야 합니다.`);
                }
                const properties = form.properties ?? {};
                if (!isObject(properties)) {
                    errors.push(`${at}.properties: 항목 정의 객체여야 합니다.`);
                    continue;
                }
                for (const field of Object.keys(properties)) {
                    if (!FIELD_CODE.test(field)) {
                        errors.push(`${at}.properties.${field}: 항목 코드는 영문으로 시작하는 영문·숫자·_ 128자 이하여야 합니다.`);
                    }
                }
                if (form.required !== undefined) {
                    if (!Array.isArray(form.required) || form.required.some((r) => typeof r !== 'string')) {
                        errors.push(`${at}.required: 항목 코드 배열이어야 합니다.`);
                    }
                    else {
                        for (const r of form.required) {
                            if (!(r in properties))
                                errors.push(`${at}.required: 정의되지 않은 항목 ${r} 을 필수로 요구합니다.`);
                        }
                    }
                }
                try {
                    ajv.compile(form);
                }
                catch (err) {
                    errors.push(`${at}: JSON Schema 를 컴파일할 수 없습니다 — ${err.message}`);
                }
                const untitled = Object.entries(properties)
                    .filter(([, p]) => isObject(p) && (typeof p.title !== 'string' || p.title.trim() === ''))
                    .map(([field]) => field);
                // 이름이 없으면 화면이 항목 코드를 라벨로 보인다 — 지원자가 읽을 수 없는 칸이다. 새 초안은 거절한다(T-M5-51, U-29).
                // 이미 적용된 설정은 그대로 동작한다 — 이 검사는 초안을 만들 때 돈다.
                if (untitled.length > 0) {
                    errors.push(`${at}: 이름(title)이 없는 항목이 있습니다. 지원자 화면에 항목 이름으로 보일 title 을 넣어 주십시오 — ${untitled.join(', ')}`);
                }
                const offStandard = Object.entries(properties)
                    .filter(([field, p]) => isObject(p) && p['x-profile'] === true && !contracts_1.COMMON_PROFILE_CODES.includes(field))
                    .map(([field]) => field);
                if (offStandard.length > 0) {
                    warnings.push(`${at}: 공통원서 표준에 없는 항목은 Vault 에서 가져올 수 없습니다 — ${offStandard.join(', ')}`);
                }
                const marked = Object.values(properties).some((p) => isObject(p) && p['x-profile'] === true);
                const legacy = form_schema_service_1.LEGACY_PROFILE_FIELDS.filter((f) => f in properties);
                if (!marked && legacy.length > 0) {
                    warnings.push(`${at}: 공통원서 항목 표시("x-profile": true)가 없어 옛 기본값(${legacy.join(', ')})을 공통원서에서 가져옵니다.`);
                }
            }
        }
    }
    // ── documents ───────────────────────────────────────────────────────
    for (const key of ['requiredDocuments', 'optionalDocuments']) {
        const docs = config[key];
        if (docs === undefined)
            continue;
        if (!isObject(docs)) {
            errors.push(`${key} 는 전형 코드별 서류 종류 배열이어야 합니다.`);
            continue;
        }
        for (const [code, list] of Object.entries(docs)) {
            unknownType(key, code);
            if (!Array.isArray(list) || list.some((t) => typeof t !== 'string')) {
                errors.push(`${key}.${code}: 서류 종류 배열이어야 합니다.`);
                continue;
            }
            for (const t of list) {
                if (!DOCUMENT_TYPE.test(t)) {
                    errors.push(`${key}.${code}: 서류 종류 ${t} 는 대문자·숫자·_ 64자 이하여야 합니다.`);
                }
            }
        }
    }
    if (config.documentLabels !== undefined) {
        if (!isObject(config.documentLabels) || Object.values(config.documentLabels).some((v) => typeof v !== 'string')) {
            errors.push('documentLabels 는 서류 종류별 이름(문자열) 객체여야 합니다.');
        }
    }
    return { errors, warnings };
}
//# sourceMappingURL=config-lint.js.map
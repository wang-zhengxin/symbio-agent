export function fail(message, status = 400) {
  throw Object.assign(new Error(message), {status});
}

export function string(value, label, limit, optional = false) {
  if (value == null && optional) return '';
  if (typeof value !== 'string' || value.length > limit || (!optional && !value.trim())) {
    fail(`${label}须为${optional ? '' : '非空'}文本，最多 ${limit} 字`);
  }
  return value.trim();
}

export function choice(value, values, label) {
  if (!values.includes(value)) fail(`${label}无效`);
  return value;
}

export function integer(value, label, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(`${label}须为 ${min} 至 ${max} 的整数`);
  return value;
}

export function ids(value, label, limit = 20) {
  if (!Array.isArray(value) || value.length > limit || value.some(id => typeof id !== 'string')) fail(`${label}无效`);
  return [...new Set(value)];
}

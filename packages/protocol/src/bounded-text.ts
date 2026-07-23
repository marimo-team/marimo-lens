export function boundedUtf16(value: string, maximum: number): string {
  let result = "";
  for (let index = 0; index < value.length && result.length < maximum; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      if (index + 1 < value.length) {
        const next = value.charCodeAt(index + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          if (result.length + 2 > maximum) break;
          result += value[index] + value[index + 1];
          index += 1;
          continue;
        }
      }
      result += "\ufffd";
      continue;
    }
    result += unit >= 0xdc00 && unit <= 0xdfff ? "\ufffd" : value[index];
  }
  return result;
}

export function hasTextContent(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (
      character === "\ufeff" ||
      (codePoint >= 0x1c && codePoint <= 0x1f) ||
      /^\p{White_Space}$/u.test(character)
    ) {
      continue;
    }
    return true;
  }
  return false;
}

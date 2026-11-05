'use strict';

(function exposeBrazilianPhone(global) {
  const BRAZIL_COUNTRY_CODE = '55';
  const VALID_DDDS = Object.freeze([
    '11', '12', '13', '14', '15', '16', '17', '18', '19',
    '21', '22', '24', '27', '28',
    '31', '32', '33', '34', '35', '37', '38',
    '41', '42', '43', '44', '45', '46', '47', '48', '49',
    '51', '53', '54', '55',
    '61', '62', '63', '64', '65', '66', '67', '68', '69',
    '71', '73', '74', '75', '77', '79',
    '81', '82', '83', '84', '85', '86', '87', '88', '89',
    '91', '92', '93', '94', '95', '96', '97', '98', '99',
  ]);

  function digitsOnly(value) {
    return String(value ?? '').replace(/\D/g, '');
  }

  function normalizeMobile(value) {
    const input = String(value ?? '').trim();
    if (!/^\+?[0-9() -]+$/.test(input)) return null;

    const digits = digitsOnly(input);
    if (input.startsWith('+') && !(digits.length === 13 && digits.startsWith(BRAZIL_COUNTRY_CODE))) {
      return null;
    }
    const national = digits.length === 13 && digits.startsWith(BRAZIL_COUNTRY_CODE)
      ? digits.slice(BRAZIL_COUNTRY_CODE.length)
      : digits.length === 11 ? digits : '';
    if (!/^[1-9]{2}9\d{8}$/.test(national)) return null;
    if (!VALID_DDDS.includes(national.slice(0, 2))) return null;
    if (national === national[0].repeat(national.length)) return null;
    return national;
  }

  function formatNationalDigits(value) {
    const digits = String(value || '').slice(0, 11);
    if (digits.length <= 2) return digits ? `(${digits}` : '';
    if (digits.length <= 7) return digits.replace(/^(\d{2})(\d+)/, '($1) $2');
    if (digits.length <= 10) return digits.replace(/^(\d{2})(\d{4})(\d+)/, '($1) $2-$3');
    return digits.replace(/^(\d{2})(\d{5})(\d+)/, '($1) $2-$3');
  }

  function formatMobileInput(value) {
    const original = String(value ?? '').trim();
    const digits = digitsOnly(original).slice(0, 13);
    const explicitCountryCode = original.startsWith('+');
    const hasBrazilCountryCode = digits.startsWith(BRAZIL_COUNTRY_CODE)
      && (explicitCountryCode || digits.length > 11);
    if (explicitCountryCode && !digits.startsWith(BRAZIL_COUNTRY_CODE)) return `+${digits}`;
    const national = hasBrazilCountryCode ? digits.slice(2) : digits;
    const formatted = formatNationalDigits(national);
    return hasBrazilCountryCode ? `+55 ${formatted}`.trimEnd() : formatted;
  }

  function formatMobileDisplay(value) {
    const canonical = normalizeMobile(value);
    if (canonical) return formatNationalDigits(canonical);
    const legacyDigits = digitsOnly(value);
    if (legacyDigits.length === 10) return legacyDigits.replace(/^(\d{2})(\d{4})(\d{4})$/, '($1) $2-$3');
    return value || 'Não informado';
  }

  global.PhoneBR = Object.freeze({
    VALID_DDDS,
    normalizeMobile,
    formatMobileInput,
    formatMobileDisplay,
  });
})(window);

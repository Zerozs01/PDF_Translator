// src/services/ocr/ocrTextNormalizer.test.ts
import { describe, expect, test } from 'vitest';
import {
  normalizeTranslationLanguage,
  cleanJapaneseOcrSpacing,
  cleanKoreanOcrSpacing,
  normalizeJapaneseOcrNoiseForTranslation,
  normalizeKoreanOcrNoiseForTranslation,
  normalizeSpanishOcrNoiseForTranslation,
  normalizeSourceForTranslation,
  normalizeWhitespace,
} from './ocrTextNormalizer';

describe('normalizeTranslationLanguage', () => {
  test('resolves standard languages and aliases correctly', () => {
    expect(normalizeTranslationLanguage('eng', 'en')).toBe('en');
    expect(normalizeTranslationLanguage('english', 'en')).toBe('en');
    expect(normalizeTranslationLanguage('tha', 'th')).toBe('th');
    expect(normalizeTranslationLanguage('thai', 'th')).toBe('th');
    expect(normalizeTranslationLanguage('jpn', 'ja')).toBe('ja');
    expect(normalizeTranslationLanguage('jpn_vert', 'ja')).toBe('ja');
    expect(normalizeTranslationLanguage('kor', 'ko')).toBe('ko');
    expect(normalizeTranslationLanguage('spa', 'es')).toBe('es');
  });

  test('falls back to default when input is empty or invalid', () => {
    expect(normalizeTranslationLanguage('', 'en')).toBe('en');
    expect(normalizeTranslationLanguage('unknown_lang', 'en')).toBe('unknown_lang');
  });
});

describe('cleanJapaneseOcrSpacing', () => {
  test('should clean spaces between Japanese characters', () => {
    expect(cleanJapaneseOcrSpacing('保 存 で き ま せ ん')).toBe('保存できません');
    expect(cleanJapaneseOcrSpacing('し て く だ さ い')).toBe('してください');
    expect(cleanJapaneseOcrSpacing('コ ソ コ ソ')).toBe('コソコソ');
  });

  test('should keep spacing between Latin and Japanese words', () => {
    expect(cleanJapaneseOcrSpacing('CPU 使 用')).toBe('CPU 使用');
    expect(cleanJapaneseOcrSpacing('settings 保 存')).toBe('settings 保存');
  });
});

describe('cleanKoreanOcrSpacing', () => {
  test('should clean spaces between Korean Hangul characters', () => {
    expect(cleanKoreanOcrSpacing('안 녕 하 세 요')).toBe('안녕하세요');
  });
});

describe('normalizeKoreanOcrNoiseForTranslation', () => {
  test('should normalize Korean full-width punctuation and common colloquial OCR forms', () => {
    expect(normalizeKoreanOcrNoiseForTranslation('완료되었습니다。')).toBe('완료되었습니다.');
    expect(normalizeKoreanOcrNoiseForTranslation('넘어가 줘 말어')).toBe('넘어가 줘 말아');
    expect(normalizeKoreanOcrNoiseForTranslation('붙여놓을라고 하는데 ㅋㅋ')).toBe('붙여놓으려고 하는데 ㅋㅋ');
    expect(normalizeKoreanOcrNoiseForTranslation('분여놓을라고하느데')).toBe('분여놓으려고하는데');
  });
});

describe('normalizeJapaneseOcrNoiseForTranslation', () => {
  test('should normalize symbols and CJK punctuation', () => {
    expect(normalizeJapaneseOcrNoiseForTranslation('。')).toBe('.');
    expect(normalizeJapaneseOcrNoiseForTranslation('、')).toBe(',');
    expect(normalizeJapaneseOcrNoiseForTranslation('！')).toBe('!');
    expect(normalizeJapaneseOcrNoiseForTranslation('？')).toBe('?');
    expect(normalizeJapaneseOcrNoiseForTranslation('エl')).toBe('えっ');
  });
});

describe('normalizeSpanishOcrNoiseForTranslation', () => {
  test('should replace common Spanish OCR artifacts', () => {
    expect(normalizeSpanishOcrNoiseForTranslation('COMOSI')).toBe('COMO SI');
    expect(normalizeSpanishOcrNoiseForTranslation('CIERTASPARTES')).toBe('CIERTAS PARTES');
    expect(normalizeSpanishOcrNoiseForTranslation('iC-COMO')).toBe('¿COMO');
    expect(normalizeSpanishOcrNoiseForTranslation('LISTOCON')).toBe('LISTO CON');
    expect(normalizeSpanishOcrNoiseForTranslation('TODOLOQUE')).toBe('TODO LO QUE');
  });
});

describe('normalizeSourceForTranslation', () => {
  test('should process Spanish texts correctly', () => {
    expect(normalizeSourceForTranslation('iC-COMO LO SUPO...?! NO ERAUNPOCO PERVERTIDO?', 'es')).toBe(
      '¿como lo supo...?! No era un poco pervertido?'
    );
  });

  test('should process Japanese texts correctly', () => {
    expect(normalizeSourceForTranslation('し　て　く　だ　さ　い。', 'ja')).toBe(
      'してください.'
    );
  });

  test('should repair digit confusion like 4O% to 40%', () => {
    expect(normalizeSourceForTranslation('GETTING 4O% OF', 'en')).toBe('Getting 40% of');
    expect(normalizeSourceForTranslation('GETTING 4o% OF', 'en')).toBe('Getting 40% of');
    expect(normalizeSourceForTranslation('I HAVE 1O0 DOLLARS', 'en')).toBe('I have 100 dollars');
  });

  test('should repair dums to dumb', () => {
    expect(normalizeSourceForTranslation('DUMS PRINCESS!!', 'en')).toBe('Dumb princess!!');
  });

  test('should repair newly added english ocr noise lines correctly', () => {
    // 1. Any-MORE -> Anymore
    expect(normalizeSourceForTranslation('IT ANY- MORE...', 'en')).toBe('It anymore...');
    expect(normalizeSourceForTranslation('IT ANY-MORE...', 'en')).toBe('It anymore...');

    // 2. CUM-MING -> CUMMING
    expect(normalizeSourceForTranslation('CUM- MING', 'en')).toBe('Cumming');
    expect(normalizeSourceForTranslation('CUM-MING', 'en')).toBe('Cumming');

    // 3. NOT NEC-ESSARY -> NOT NECESSARY
    expect(normalizeSourceForTranslation('NOT NEC- ESSARY', 'en')).toBe('Not necessary');
    expect(normalizeSourceForTranslation('NOT NEC-ESSARY', 'en')).toBe('Not necessary');

    // 4. IMPRESSION, EXPRESSION, THATCANTBE IT
    expect(normalizeSourceForTranslation('A BAD I MPRESS I ON', 'en')).toBe('A bad impression');
    expect(normalizeSourceForTranslation('THATCANTBE IT', 'en')).toBe("That can't be it");
    expect(normalizeSourceForTranslation('EXPRESS I ON', 'en')).toBe('Expression');

    // 5. GETTiNG, FiRST, 455, A55, YOU FUR KRASHING MY BAEBY
    expect(normalizeSourceForTranslation('GETTiNG', 'en')).toBe('Getting');
    expect(normalizeSourceForTranslation('FiRST', 'en')).toBe('First');
    expect(normalizeSourceForTranslation('AGAA', 'en')).toBe('Again');
    expect(normalizeSourceForTranslation('455', 'en')).toBe('Ass');
    expect(normalizeSourceForTranslation('A55', 'en')).toBe('Ass');
    expect(normalizeSourceForTranslation('YOU FUR KRASHING MY BAEBY', 'en')).toBe("You're crushing my baby");
    expect(normalizeSourceForTranslation('YOU FUR CRUNCHING MY BAEBY', 'en')).toBe("You're crushing my baby");
    expect(normalizeSourceForTranslation('COO+000+7OCKS', 'en')).toBe('Cooooooocks');
    expect(normalizeSourceForTranslation('168', 'en')).toBe('');
  });

  test('should restore hyphenated words with Unicode characters and no spaces', () => {
    expect(normalizeSourceForTranslation('AC-TUALDAD', 'es')).toBe('actualidad');
    expect(normalizeSourceForTranslation('servi-cio', 'es')).toBe('servicio');
    expect(normalizeSourceForTranslation('strea-ming', 'es')).toBe('streaming');
    expect(normalizeSourceForTranslation('PRO-FESORA', 'es')).toBe('Profesora');
  });

  test('should repair Spanish OCR noises', () => {
    expect(normalizeSourceForTranslation('MENTE UN REGALO.', 'es')).toBe('un regalo para la mente.');
    expect(normalizeSourceForTranslation('DO DE ESTUDIAR', 'es')).toBe('donde estudiar');
    expect(normalizeSourceForTranslation('RIO MUY', 'es')).toBe('río muy');
    expect(normalizeSourceForTranslation('GO QUE TENDRE QUE', 'es')).toBe('tengo que ir');
    expect(normalizeSourceForTranslation('VERSACION', 'es')).toBe('versión');
    expect(normalizeSourceForTranslation('iUNA SENAL', 'es')).toBe('¡una señal');
    expect(normalizeSourceForTranslation('CCPELICULA', 'es')).toBe('película');
    expect(normalizeSourceForTranslation('TAMENTO DE INGLES', 'es')).toBe('Departamento de inglés');
    expect(normalizeSourceForTranslation('CEN,TODOSSON', 'es')).toBe('Cen todosson');
    expect(normalizeSourceForTranslation('que?', 'es')).toBe('¿qué?');
    expect(normalizeSourceForTranslation('BIRME A', 'es')).toBe('suscribir me a');
    expect(normalizeSourceForTranslation('TIDO PRESTADO', 'es')).toBe('tiempo prestado');
    expect(normalizeSourceForTranslation('PRAR', 'es')).toBe('comprar');
    expect(normalizeSourceForTranslation('RON UNA FIESTA', 'es')).toBe('organizaron una fiesta');
    expect(normalizeSourceForTranslation('BIEN TE GUSTAN', 'es')).toBe('también te gustan');
    expect(normalizeSourceForTranslation('SECUNDA RIA', 'es')).toBe('secundaria');
    expect(normalizeSourceForTranslation('FRAZ PARA', 'es')).toBe('disfraz para');
    expect(normalizeSourceForTranslation('TONCES', 'es')).toBe('entonces');
    expect(normalizeSourceForTranslation('RATURA DELAIRE', 'es')).toBe('temperatura del aire');
    expect(normalizeSourceForTranslation('GUIDA.', 'es')).toBe('seguida.');
  });
});



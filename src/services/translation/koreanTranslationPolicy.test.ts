import { describe, it, expect } from 'vitest';
import {
  normalizeKoreanColloquialOcrText,
  applyKoreanConversationalFallback,
  getKoreanTranslationScriptStats,
  hasKoreanTranslationCarryover,
  shouldPreferKoreanPivotTranslation
} from './koreanTranslationPolicy';

describe('koreanTranslationPolicy', () => {
  describe('normalizeKoreanColloquialOcrText', () => {
    it('normalizes CJK punctuation to Western style', () => {
      expect(normalizeKoreanColloquialOcrText('안녕。')).toBe('안녕.');
      expect(normalizeKoreanColloquialOcrText('뭐지？')).toBe('뭐지?');
      expect(normalizeKoreanColloquialOcrText('와우！')).toBe('와우!');
    });

    it('repairs common Korean colloquial OCR spelling errors', () => {
      expect(normalizeKoreanColloquialOcrText('가지말어')).toBe('가지말아');
      expect(normalizeKoreanColloquialOcrText('하느데')).toBe('하는데');
      expect(normalizeKoreanColloquialOcrText('먹을라고')).toBe('먹으려고');
    });
  });

  describe('applyKoreanConversationalFallback', () => {
    it('returns null for non-Korean source texts', () => {
      expect(applyKoreanConversationalFallback('Hello', 'สวัสดี')).toBeNull();
      expect(applyKoreanConversationalFallback('', '')).toBeNull();
    });

    it('returns mapped Thai translation for exact matched short words and preserves trailing punctuation', () => {
      expect(applyKoreanConversationalFallback('헉!', '헉!')).toBe('เฮือก!');
      expect(applyKoreanConversationalFallback('헉헉...', '헉헉')).toBe('แฮ่กๆ...');
      expect(applyKoreanConversationalFallback('하하하', '하하하')).toBe('ฮ่าๆๆ');
      expect(applyKoreanConversationalFallback('절레!!!', '절레')).toBe('ส่ายหน้า!!!');
    });

    it('returns mapped Thai translation for matched conversational phrases', () => {
      expect(applyKoreanConversationalFallback('걸레년', '걸레년')).toBe('อีผู้หญิงสำส่อน');
      expect(applyKoreanConversationalFallback('몸으로 때운다고?', '')).toBe('จะใช้ร่างกายชดเชยงั้นเหรอ?');
      expect(applyKoreanConversationalFallback('미친색까 뒤지기 싫으면', '미친색까')).toBe('ไอ้สารเลว ถ้าไม่อยากตาย');
      expect(applyKoreanConversationalFallback('그런데', '')).toBe('อย่างไรก็ตาม');
      expect(applyKoreanConversationalFallback('저기요!', '')).toBe('ขอโทษนะ!');
      expect(applyKoreanConversationalFallback('이런...', '')).toBe('แบบนี้...');
      expect(applyKoreanConversationalFallback('자.', '')).toBe('เอาล่ะ.');
      expect(applyKoreanConversationalFallback('이 나이에\n섹스를 하는 것\n만으로도…\n죄책감이 7\n장난 아닌데…', '')).toBe('ในวัยนี้ แค่มีเพศสัมพันธ์… ความรู้สึกผิดไม่ใช่เรื่องเล่นๆเลย…');
      expect(applyKoreanConversationalFallback('어쩔수', '')).toBe('ช่วยไม่ได้นะ');
      expect(applyKoreanConversationalFallback('밑으로...', '')).toBe('ข้างล่าง...');
      expect(applyKoreanConversationalFallback('잠깐?!', '')).toBe('เดี๋ยวก่อน?!');
      expect(applyKoreanConversationalFallback('뭐야!', '')).toBe('อะไรกัน!');
    });

    it('returns null when no pattern matches', () => {
      expect(applyKoreanConversationalFallback('안녕하세요 저는 학생입니다', 'สวัสดี')).toBeNull();
    });
  });

  describe('getKoreanTranslationScriptStats', () => {
    it('calculates counts and ratios of Hangul, Thai, and Latin characters', () => {
      const stats = getKoreanTranslationScriptStats('한국어 Hello สวัสดี');
      expect(stats.hangulChars).toBe(3);
      expect(stats.latinChars).toBe(5);
      expect(stats.thaiChars).toBe(6);
      expect(stats.letterChars).toBe(14);
      expect(stats.hangulRatio).toBeCloseTo(3 / 14, 4);
      expect(stats.latinRatio).toBeCloseTo(5 / 14, 4);
      expect(stats.thaiRatio).toBeCloseTo(6 / 14, 4);
    });
  });

  describe('hasKoreanTranslationCarryover', () => {
    it('returns true when Hangul characters exist but no Thai characters', () => {
      expect(hasKoreanTranslationCarryover('한국어 Hello')).toBe(true);
      expect(hasKoreanTranslationCarryover('지울거지응')).toBe(true);
    });

    it('returns false when Thai characters are present', () => {
      expect(hasKoreanTranslationCarryover('สวัสดี 한국어')).toBe(false);
      expect(hasKoreanTranslationCarryover('สวัสดี')).toBe(false);
    });

    it('returns false when no Hangul is present', () => {
      expect(hasKoreanTranslationCarryover('Hello')).toBe(false);
    });
  });

  describe('shouldPreferKoreanPivotTranslation', () => {
    it('returns true if pivot text contains Thai but direct text has none and contains Latin', () => {
      expect(shouldPreferKoreanPivotTranslation('출력', 'Print', 'พิมพ์ออกมา')).toBe(true);
    });

    it('returns false if pivot has no Thai', () => {
      expect(shouldPreferKoreanPivotTranslation('출력', 'พิมพ์ออกมา', 'Print')).toBe(false);
    });

    it('returns true if pivot has significantly more Thai characters', () => {
      // Direct has 2 Thai, Pivot has 12 Thai chars
      expect(shouldPreferKoreanPivotTranslation(
        '출력해서집에붙여놓을라고하는데',
        'แปะ',
        'ฉันวางแผนจะพิมพ์ออกมาแล้วเอาไปติดไว้ที่บ้าน'
      )).toBe(true);
    });

    it('returns true if direct text matches source key but pivot doesn\'t (meaning direct failed to translate)', () => {
      expect(shouldPreferKoreanPivotTranslation('음', '음', 'อืม')).toBe(true);
    });
  });
});

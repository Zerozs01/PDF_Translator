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
      expect(applyKoreanConversationalFallback('자신이무시하던남자에게 엉덩이활짝내밀고든', '')).toBe('เธอยื่นก้นออกไปให้ผู้ชายที่เธอเคยเมินเฉย');
      expect(applyKoreanConversationalFallback('쾌락에패배하고굴복해서', '')).toBe('พ่ายแพ้และยอมจำนนต่อความสุข');
      expect(applyKoreanConversationalFallback('가장무방비한자세로 보지대주고있는상황을', '')).toBe('สถานการณ์ที่เสนออวัยวะเพศหญิงของตนเองในตำแหน่งที่ไร้การป้องกันที่สุด');
      expect(applyKoreanConversationalFallback('하앙!?', '')).toBe('ฮ๊าง!?');
      expect(applyKoreanConversationalFallback('이대로...', '')).toBe('แบบนี้...');
      expect(applyKoreanConversationalFallback('아니...', '')).toBe('ไม่...');
      expect(applyKoreanConversationalFallback('그럼...', '')).toBe('ถ้าอย่างนั้น...');
      expect(applyKoreanConversationalFallback('살살 해줄게', '')).toBe('จะทำเบาๆ ให้');
      expect(applyKoreanConversationalFallback('사랑해', '')).toBe('รักนะ');
      expect(applyKoreanConversationalFallback('아니 뭐...', '')).toBe('เปล่าหรอก แค่...');
      expect(applyKoreanConversationalFallback('살생겼의', '')).toBe('หล่อจัง');
      expect(applyKoreanConversationalFallback('잘 생겼다♡', '')).toBe('หล่อจัง♡');
      expect(applyKoreanConversationalFallback('엄마 사촌', '')).toBe('ลูกพี่ลูกน้องของแม่');
      expect(applyKoreanConversationalFallback('마리코 아들', '')).toBe('ลูกชายของมาริโกะ');
      expect(applyKoreanConversationalFallback('렌이야!', '')).toBe('เรนไงล่ะ!');
      expect(applyKoreanConversationalFallback('당연히 안되지', '')).toBe('แน่นอนว่าไม่ได้หรอก');
      expect(applyKoreanConversationalFallback('꼬맹이네', '')).toBe('เด็กคนนั้น');
      expect(applyKoreanConversationalFallback('부모님도', '')).toBe('พ่อแม่ก็ด้วย');
      expect(applyKoreanConversationalFallback('떨굴거야', '')).toBe('จะทำให้ตก');
      expect(applyKoreanConversationalFallback('그래그래', '')).toBe('ใช่แล้ว ใช่แล้ว');
      expect(applyKoreanConversationalFallback('렌? 껴안지 않아도, 너한', '')).toBe('เรน? ไม่ต้องกอดก็ได้ ให้เธอ');
      expect(applyKoreanConversationalFallback('개허접 걸레년 주제에 나대지마!', '')).toBe('อีผู้หญิงสำส่อนไม่ได้เรื่องเอ๊ย อย่ามาสะเออะ!');
      expect(applyKoreanConversationalFallback('이압이 이압이', '')).toBe('ยึบ ยึบ');
      expect(applyKoreanConversationalFallback('거거긴 만지면', '')).toBe('ตร-ตรงนั้นถ้าไปจับโดนเข้าล่ะก็');
      expect(applyKoreanConversationalFallback('같았는데', '')).toBe('เหมือนว่า...แท้ๆ');
      expect(applyKoreanConversationalFallback('꼬맹이라고 거유녀랑 재우니까 불끈거린다고', '')).toBe('หาว่าเป็นเด็ก แต่พอให้นอนกับสาวนมโตแล้วมันคึกจนแข็งเป๊กเลยนี่หว่า');
      expect(applyKoreanConversationalFallback('알면서', '')).toBe('ทั้งที่รู้อยู่แท้ๆ');
      expect(applyKoreanConversationalFallback('그걸로 뭐하려고', '')).toBe('จะเอาอันนั้นไปทำอะไรน่ะ');
      expect(applyKoreanConversationalFallback('아무리 그래도 그건--!', '')).toBe('ถึงอย่างนั้นก็เถอะ แบบนั้นมัน--!');
      expect(applyKoreanConversationalFallback('그럴리가', '')).toBe('ไม่มีทางหรอก');
      expect(applyKoreanConversationalFallback('네엄마 쉬워보이던เด 남편옆에서 동생만들어줄게', '')).toBe('แม่ของเธอแลดูง่ายดีนี่นา เดี๋ยวจะสร้างน้องข้างๆ สามีให้ดูนะ');
      expect(applyKoreanConversationalFallback('갑자기 어리광 부리지 말라고', '')).toBe('จู่ๆ อย่ามาทำเป็นออดอ้อนนะ');
      expect(applyKoreanConversationalFallback('갑자기 어리광 부리지 말라고!', '')).toBe('จู่ๆ อย่ามาทำเป็นออดอ้อนนะ!');
      expect(applyKoreanConversationalFallback('말구.', '')).toBe('อย่า.');
      expect(applyKoreanConversationalFallback('하아...', '')).toBe('เฮ้อ...');
      expect(applyKoreanConversationalFallback('옛날의 우리로선', '')).toBe('สำหรับพวกเราในอดีต');
      expect(applyKoreanConversationalFallback('하늘아!', '')).toBe('ฮานึล!');
      expect(applyKoreanConversationalFallback('내 말이!', '')).toBe('นั่นน่ะสิ!');
      expect(applyKoreanConversationalFallback('아무튼 그래서...', '')).toBe('อย่างที่บอกไปว่า...');
      expect(applyKoreanConversationalFallback('계속 좋아해 준다는 그 약속만 잘 지켜준다면--', '')).toBe('ถ้าเธอยังคงรักษาสัญญาว่าจะชอบฉันตลอดไป--');

      // User requested Manhwa dialogues
      expect(applyKoreanConversationalFallback('아니잠깐', '')).toBe('เดี๋ยวก่อนสิ');
      expect(applyKoreanConversationalFallback('그렇구나', '')).toBe('อย่างนี้นี่เอง');
      expect(applyKoreanConversationalFallback('좋아해요', '')).toBe('ชอบนะคะ');
      expect(applyKoreanConversationalFallback('어느새제가', '')).toBe('ไม่ทันรู้ตัว ตัวฉันก็');
      expect(applyKoreanConversationalFallback('어느새제가...', '')).toBe('ไม่ทันรู้ตัว ตัวฉันก็...');
      expect(applyKoreanConversationalFallback('그러세요', '')).toBe('เชิญเลยค่ะ');
      expect(applyKoreanConversationalFallback('저를좋아하는지부터', '')).toBe('เริ่มจากว่าชอบฉันหรือเปล่า');
      expect(applyKoreanConversationalFallback('그걸지금', '')).toBe('เรื่องนั้น ตอนนี้น่ะ');
      expect(applyKoreanConversationalFallback('그걸지금...', '')).toBe('เรื่องนั้น ตอนนี้น่ะ...');
      expect(applyKoreanConversationalFallback('말이라고하냐', '')).toBe('พูดแบบนั้นออกมาได้ยังไง');
      expect(applyKoreanConversationalFallback('그런짓까지다허락해놓고', '')).toBe('ทั้งที่ยอมให้ทำเรื่องแบบนั้นไปหมดแล้วแท้ๆ');
      expect(applyKoreanConversationalFallback('서도연하고나하고', '')).toBe('ซอดอยอนกับฉัน');
      expect(applyKoreanConversationalFallback('울언으읍!!', '')).toBe('อื้ออื๊บ!!');
      expect(applyKoreanConversationalFallback('디진다진짜', '')).toBe('เดี๋ยวตายจริงๆ แน่');
      expect(applyKoreanConversationalFallback('널심란하게', '')).toBe('ทำให้เธอว้าวุ่นใจ');
      expect(applyKoreanConversationalFallback('안된다느니뭐니', '')).toBe('บอกว่าไม่ได้บ้างล่ะ อะไรบ้างล่ะ');
      expect(applyKoreanConversationalFallback('이땅걸물어보고', '')).toBe('มาถามเรื่องพรรค์นี้');
      expect(applyKoreanConversationalFallback('하고싶은대로', '')).toBe('ตามที่อยากทำ');
      expect(applyKoreanConversationalFallback('생각해보면너', '')).toBe('พอลองคิดดูแล้ว เธอ');
      expect(applyKoreanConversationalFallback('생각해보면너...', '')).toBe('พอลองคิดดูแล้ว เธอ...');
      expect(applyKoreanConversationalFallback('우리과에', '')).toBe('ในสาขาของเรา');
      expect(applyKoreanConversationalFallback('예쁘고가슴큰년들은', '')).toBe('พวกชะนีสวยๆ นมโตๆ');
      expect(applyKoreanConversationalFallback('죄다긁어모아서', '')).toBe('กวาดมารวมกันหมด');
      expect(applyKoreanConversationalFallback('연하늘은', '')).toBe('ยอนฮานึลน่ะ');
      expect(applyKoreanConversationalFallback('너가더잘알거고', '')).toBe('เธอคงจะรู้ดีกว่าใคร');
      expect(applyKoreanConversationalFallback('내내가바라는게', '')).toBe('สิ่งที่ฉัน... ฉันต้องการ');
      expect(applyKoreanConversationalFallback('수치스럽게', '')).toBe('อย่างน่าอับอาย');
      expect(applyKoreanConversationalFallback('조, 조용히 해요 선배!', '')).toBe('ชะ... เงียบๆ หน่อยครับรุ่นพี่!');
      expect(applyKoreanConversationalFallback('네? 뭐…', '')).toBe('คะ? อะไรนะ…');
      expect(applyKoreanConversationalFallback('예, 뭐.그건 부부나 연인들 이야기 아니에요?', '')).toBe('ใช่ เอ่อ... นั่นมันเรื่องของสามีภรรยาหรือคู่รักไม่ใช่เหรอครับ?');
      expect(applyKoreanConversationalFallback('에휴…', '')).toBe('เฮ้อ…');
      expect(applyKoreanConversationalFallback('제 이기심을 받아들여 줘서.그 연인같은 섹스를', '')).toBe('ที่ยอมรับความเห็นแก่ตัวของฉัน... เซ็กส์ที่เหมือนคู่รักแบบนั้น');
      expect(applyKoreanConversationalFallback('이건데 …?', '')).toBe('คืออันนี้เหรอ…?');

      // Newly added user phrases
      expect(applyKoreanConversationalFallback('우리과사람들', '')).toBe('คนในสาขาของเรา');
      expect(applyKoreanConversationalFallback('웃기게들릴건', '')).toBe('คงจะฟังดูตลกนะ');
      expect(applyKoreanConversationalFallback('육체적인관계로만', '')).toBe('แค่ความสัมพันธ์ทางกายเท่านั้น');
      expect(applyKoreanConversationalFallback('자길좋아하냐고', '')).toBe('ถามว่าชอบตัวเองหรือเปล่า');
      expect(applyKoreanConversationalFallback('아니그런거', '')).toBe('เปล่า ไม่ใช่เรื่องแบบนั้น');
      expect(applyKoreanConversationalFallback('버린다든가', '')).toBe('ทิ้งไป หรืออะไรแบบนั้น');
      expect(applyKoreanConversationalFallback('그런살벌한', '')).toBe('เรื่องที่น่ากลัวแบบนั้น');
      expect(applyKoreanConversationalFallback('기기적인해계지면프', '')).toBe('เรื่องมหัศจรรย์');
      expect(applyKoreanConversationalFallback('그다지좋다고', '')).toBe('ไม่ได้บอกว่าชอบขนาดนั้น');
      expect(applyKoreanConversationalFallback('그런유리선배를', '')).toBe('รุ่นพี่ยูริแบบนั้น');
      expect(applyKoreanConversationalFallback('뒤집어버리려던게', '')).toBe('ที่ตั้งใจจะพลิกกลับกลายมาเป็น');
      expect(applyKoreanConversationalFallback('진심으로', '')).toBe('อย่างจริงใจ');
      expect(applyKoreanConversationalFallback('좋아하게됐다는걸', '')).toBe('กลายเป็นชอบเข้าจริงๆ');
      expect(applyKoreanConversationalFallback('아시다시피저는', '')).toBe('อย่างที่รู้กัน ตัวฉันน่ะ');
      expect(applyKoreanConversationalFallback('복종심을이용해서', '')).toBe('อาศัยความยอมจำนน');
      expect(applyKoreanConversationalFallback('좋아하라고강요하는듯', '')).toBe('เหมือนบังคับให้ชอบ');
      expect(applyKoreanConversationalFallback('양심적이어서', '')).toBe('รู้สึกผิดชอบชั่วดี');
      expect(applyKoreanConversationalFallback('연읍!!', '')).toBe('อื้ออื๊บ!!');
      expect(applyKoreanConversationalFallback('탓읍!!', '')).toBe('ทัต... อึ้บ!!');
      expect(applyKoreanConversationalFallback('참내', '')).toBe('ให้ตายสิ');
      expect(applyKoreanConversationalFallback('이다걸물어보고', '')).toBe('มาถามเรื่องพรรค์นี้');
      expect(applyKoreanConversationalFallback('최다긁어모아서', '')).toBe('กวาดมารวมกันหมด');
      expect(applyKoreanConversationalFallback('떠가더잘알거고', '')).toBe('เธอคงจะรู้ดีกว่าใคร');
      expect(applyKoreanConversationalFallback('꽤 핫플레이스인데.', '')).toBe('เป็นสถานที่ยอดฮิตเลยนะ.');
      expect(applyKoreanConversationalFallback('내가 좋아하는 사람이,', '')).toBe('คนที่ฉันชอบ');
      expect(applyKoreanConversationalFallback('흔한 일은 아니잖아요.', '')).toBe('มันไม่ใช่เรื่องธรรมดาๆ ทั่วไปนี่ครับ.');
      expect(applyKoreanConversationalFallback('그런 기적이 왔는데\n도파민 때문에 놓치면,', '')).toBe('ปาฏิหาริย์แบบนั้นมาถึงแล้ว ถ้าต้องพลาดไปเพราะโดพามีนล่ะก็');
      expect(applyKoreanConversationalFallback('서로 좋아하는 기회를\n놓칠까 봐 걱정을 해?', '')).toBe('กังวลว่าจะพลาดโอกาสที่จะได้ชอบพอกันงั้นเหรอ?');
      expect(applyKoreanConversationalFallback('이게', '')).toBe('สิ่งนี้');
      expect(applyKoreanConversationalFallback('너도 마음이 있어서', '')).toBe('เธอก็มีใจเหมือนกัน');
      expect(applyKoreanConversationalFallback('아니,…저는 유리 선배도', '')).toBe('เปล่าครับ... สำหรับผม รุ่นพี่ยูริก็');
      expect(applyKoreanConversationalFallback('그런 짓 예시', '')).toBe('ตัวอย่างเรื่องแบบนั้น');
      expect(applyKoreanConversationalFallback('조, 조용히 해요 선배!\n여기 공원이에요!', '')).toBe('ชะ... เงียบๆ หน่อยครับรุ่นพี่! ที่นี่มันสวนสาธารณะนะ!');
      expect(applyKoreanConversationalFallback('하게 해 드려야지 별 수 있나.', '')).toBe('ก็ต้องยอมให้ทำล่ะนะ จะมีทางเลือกอื่นได้ยังไง.');
      expect(applyKoreanConversationalFallback('그 연인같은 섹스를', '')).toBe('เซ็กส์ที่เหมือนคู่รักแบบนั้น');
      expect(applyKoreanConversationalFallback('예?유리선배?', '')).toBe('ใช่เหรอครับ? รุ่นพี่ยูริ?');

      // Newly added Manhwa and Afterword phrases
      expect(applyKoreanConversationalFallback('쿠기사키 제대로 쪼여란', '')).toBe('คุกิซากิ ขมิบแน่นๆ เข้าสิ');
      expect(applyKoreanConversationalFallback('가슴압 착하구만 자 포상이다', '')).toBe('บดขยี้หน้าอกได้ดีนี่ เอาล่ะ นี่คือรางวัล');
      expect(applyKoreanConversationalFallback('아아젠장 자지냄새로 흥분해서', '')).toBe('อ๊า ให้ตายสิ ดันมีอารมณ์เพราะกลิ่นดุ้นเนี่ยนะ');
      expect(applyKoreanConversationalFallback('교사랑 학생이 해도될 키스가 아니야', '')).toBe('ไม่ใช่จูบที่ครูกับนักเรียนควรทำกันนะ');
      expect(applyKoreanConversationalFallback('일단전편이란생각으로그렸습니다', '')).toBe('ในเบื้องต้นวาดขึ้นมาโดยกะให้เป็นตอนแรกครับ');
      expect(applyKoreanConversationalFallback('속편네임도있지만글세요', '')).toBe('ถึงจะมีเนมของภาคต่ออยู่บ้างแต่ก็ยังไม่แน่ใจครับ');
      expect(applyKoreanConversationalFallback('완성직후라이책이꼴리는지어떤지', '')).toBe('เพิ่งวาดเสร็จหมาดๆ เลยยังไม่รู้ว่าเล่มนี้จะกระตุ้นอารมณ์ได้แค่ไหน');
      expect(applyKoreanConversationalFallback('모르는상태라크속편을그릴지는', '')).toBe('ยังไม่รู้แน่ชัดว่าจะได้วาดภาคต่อไหม');
      expect(applyKoreanConversationalFallback('지원사이트등에도', '')).toBe('ทางเว็บไซต์ซัพพอร์ต');
      expect(applyKoreanConversationalFallback('응원해주시면기쁘겠습니다', '')).toBe('ถ้าช่วยสนับสนุนและให้กำลังใจจะยินดีเป็นอย่างยิ่งครับ');
      expect(applyKoreanConversationalFallback('มดลูก 찌부러져-', '')).toBe('มดลูกโดนบี้แบนไปหมดแล้ว-');
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

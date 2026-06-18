import type { BBox, OCRLine } from '../../types';
import type { TranslationMode } from '../../stores/useProjectStore';
import {
  normalizeWhitespace,
  normalizeSourceForTranslation,
  normalizeTranslationLanguage,
  normalizeSpanishOcrNoiseForTranslation,
  cleanJapaneseOcrSpacing,
  cleanKoreanOcrSpacing,
  normalizeJapaneseOcrNoiseForTranslation,
  normalizeKoreanOcrNoiseForTranslation,
  normalizeEnglishOcrNoiseForTranslation,
} from '../ocr/ocrTextNormalizer';
import { isKnownShortWordHelper, isLikelyEnglishDialogue } from '../ocr/ocrSafetyLineDedup';

import {
  hasKoreanTranslationCarryover,
} from './koreanTranslationPolicy';

import {
  normalizeOverlayInlineText,
  type OverlayTypography,
} from '../../components/OCR/translationOverlayUtils';

// -------------------------------------------------------------
// Translation Constants and Tables
// -------------------------------------------------------------

export const ARGOS_SHORT_PHRASE_LOOKUP_TH: Record<string, string> = {
  // Pronouns
  'way too good': 'ดีงามเกินไปแล้ว', 'way too good...': 'ดีงามเกินไปแล้ว...', 'way too good,': 'ดีงามเกินไปแล้ว', 'way too good,,': 'ดีงามเกินไปแล้ว',
  'not nec': 'ไม่จำเป็น', 'not nec...': 'ไม่จำเป็น...',
  'not necessary': 'ไม่จำเป็น', 'not necessary...': 'ไม่จำเป็น...', 'not necessary.': 'ไม่จำเป็น.',
  'excuse': 'ขอโทษนะ', 'excuse...': 'ขอโทษนะ...',
  'cumming': 'แตกแล้ว', 'cumming...': 'แตกแล้ว...', 'cumming!': 'แตกแล้ว!',
  'about the foreplay': 'แล้วบทนำล่ะ', 'about the foreplay?': 'แล้วบทนำล่ะ?', 'about the foreplay!?': 'แล้วบทนำล่ะ!?',
  'ment after': 'การรักษาหลังจากนี้', 'ment after...': 'การรักษาหลังจากนี้...',
  'row': 'แถว', 'row...': 'แถว...',
  'suddenly': 'ทันใดนั้น', 'suddenly...': 'ทันใดนั้น...', 'suddenly!': 'ทันใดนั้น!',
  'but...': 'แต่...', 'but': 'แต่',
  'form a medical': 'การตรวจทางการแพทย์', 'form a medical...': 'การตรวจทางการแพทย์...',
  'blowjob': 'อมควย', 'blowjob...': 'อมควย...', 'blowjob!': 'อมควย!',
  'barbarians!!': 'ไอ่พวกบา-บาเรียน!!', 'barbarians': 'ไอ่พวกบา-บาเรียน',
  'pregnant': 'ตั้งท้อง', 'pregnant...': 'ตั้งท้อง...', 'pregnant!': 'ตั้งท้อง!',
  's-sto ooo op...': 'ห-หยุด ดดด ดดด...', 's-stooooop...': 'ห-หยุด ดดด ดดด...',
  'frfo': '', 'frfo...': '',
  'stinky': 'เหม็นตุๆ', 'stinky!': 'เหม็นตุๆ!', 'stinky...': 'เหม็นตุๆ...',
  'kill me': 'ฆ่าฉันที', 'kill me!': 'ฆ่าฉันที!', 'kill me!!': 'ฆ่าฉันที!!',
  'with procreation': 'ด้วยการสืบพันธุ์', 'with procreation...': 'ด้วยการสืบพันธุ์...',
  'pregnant with': 'ตั้งท้องกับ', 'pregnant with...': 'ตั้งท้องกับ...',
  'then try and hold back your orgasm you pig': 'ถ้าอย่างนั้นก็พยายามกลั้นจุดสุดยอดของแกไว้ซะสิ ไอ้หมูโสโครก!',
  'then try and hold back your orgasm you pig!': 'ถ้าอย่างนั้นก็พยายามกลั้นจุดสุดยอดของแกไว้ซะสิ ไอ้หมูโสโครก!',
  'then try and hold back your orgasm you pig!!': 'ถ้าอย่างนั้นก็พยายามกลั้นจุดสุดยอดของแกไว้ซะสิ ไอ้หมูโสโครก!!',
  'i': 'ฉัน', 'you': 'คุณ', 'he': 'เขา', 'she': 'เธอ',
  'we': 'เรา', 'they': 'พวกเขา', 'it': 'มัน', 'me': 'ฉัน',
  'him': 'เขา', 'her': 'เธอ', 'us': 'พวกเรา', 'them': 'พวกเขา', 'us the': 'พวกเรา',
  'expect': 'คาดคิด', 'expect...': 'คาดคิด...', 'expect!': 'คาดคิด!',
  'and her': 'และเธอ', 'and her...': 'และเธอ...', 'and her!': 'และเธอ!',
  'you front us the getting away with': 'แกที่อยู่ข้างหน้า คิดว่าจะหนีพวกเราพ้นงั้นเหรอ!',
  'you re': 'คุณคือ', 'you re...': 'คุณคือ...', 'you re!': 'คุณคือ!',
  'knight': 'อัศวิน', 'knight...': 'อัศวิน...', 'knight!': 'อัศวิน!',
  'kniiight': 'อัศวิน', 'kniiight...': 'อัศวิน...', 'kniiight!': 'อัศวิน!',
  'kniiiight': 'อัศวิน', 'kniiiight...': 'อัศวิน...', 'kniiiight!': 'อัศวิน!',
  'that': 'นั่น', 'feels': 'รู้สึก', 'that-': 'นั่น-',
  'front': 'ข้างหน้า', 'front.': 'ข้างหน้า',
  'you front': 'แกอยู่ข้างหน้า', 'you front!': 'แกอยู่ข้างหน้า!',
  'kniiiiiight': 'อัศวิน', 'kniiiiight': 'อัศวิน', 'kniiiiight!': 'อัศวิน!',
  'youre': 'คุณคือ', 'you\'re': 'คุณคือ',
  'hes': 'เขาคือ', 'he\'s': 'เขาคือ',
  'to be dead now': 'ต้องตายไปแล้ว', 'to be dead now!': 'ต้องตายไปแล้ว!',
  'get': 'เอา', 'get!': 'เอา!',
  'cum': 'แตก', 'cum!': 'แตก!', 'cum!!': 'แตก!!',
  'i-i': 'ฉัน...', 'ii': 'ฉัน...', 'i-im': 'ฉัน...', 'i-i\'m': 'ฉัน...', 'i-i\'ll': 'ฉัน...',
  'nipples': 'หัวนม',
  'longer': 'นานขึ้น',
  'longer!': 'นานขึ้น!',
  'today again': 'วันนี้อีกแล้ว',
  'her posi': 'ท่าของเธอ',
  'her position': 'ท่าของเธอ',
  'suits': 'เหมาะกับ',
  'so': 'ช่าง...',
  'nipples and': 'หัวนมและ',
  'cervix': 'ปากมดลูก',
  'general': 'นายพล',
  'die along': 'ตายตามกันไป',
  'also': 'ด้วยเหมือนกัน',
  'her place': 'ที่ของเธอ',
  'make sure': 'ให้แน่ใจ',
  'sadness': 'ความเศร้า',
  'all arstocrats': 'เหล่าขุนนางทั้งหมด',
  'all aristocrats': 'เหล่าขุนนางทั้งหมด',
  'praise': 'ชื่นชม', 'praise...': 'ชื่นชม...', 'praise!': 'ชื่นชม!',
  'roseria': 'โรเซเรีย', 'roseria...': 'โรเซเรีย...', 'roseria!': 'โรเซเรีย!',
  'king and': 'ราชาและ',
  'but in any age': 'แต่ไม่ว่าจะในยุคสมัยใด',
  'if i': 'ถ้าฉัน',
  'toyed with': 'เล่นสนุกกับ',
  'dead': 'ตาย',
  'recapturing': 'การยึดกลับคืน',
  // Interjections / short responses
  'yes': 'ใช่', 'no': 'ไม่', 'ok': 'โอเค', 'okay': 'โอเค',
  'sir': 'ท่าน', 'yes sir': 'ครับท่าน',
  'quck': 'เร็ว', 'quick': 'เร็ว',
  'what': 'อะไร', 'why': 'ทำไม', 'how': 'อย่างไร', 'when': 'เมื่อไหร่',
  'where': 'ที่ไหน', 'who': 'ใคร', 'wait': 'รอก่อน', 'stop': 'หยุด',
  'go': 'ไป', 'run': 'วิ่ง', 'help': 'ช่วยด้วย', 'look': 'ดูสิ',
  'now': 'ตอนนี้', 'here': 'ที่นี่', 'there': 'ที่นั่น', 'come': 'มา',
  'hey': 'เฮ้ย', 'huh': 'หยิ', 'hm': 'อืม', 'hmm': 'อืม',
  'ah': 'อา', 'oh': 'โอ้', 'uh': 'เอ่อ', 'ugh': 'โอ๊ย',
  'ugh!': 'โอ๊ย!', 'ugh!!': 'โอ๊ย!!', 'ugh,': 'โอ๊ย!',
  'wow': 'ว้าว', 'whoa': 'โว้ว', 'ha': 'ฮ่า',
  'haa': 'ฮ่าฮ่า', 'haa!': 'ฮ่าฮ่า!', 'haa!!': 'ฮ่าฮ่า!!', 'haa...': 'ฮ่าฮ่า...',
  'even': 'แม้แต่', 'even!': 'แม้แต่!',
  'thanks': 'ขอบคุณ', 'sorry': 'ขอโทษ', 'please': 'ได้โปรด', 'please!': 'ได้โปรด!', 'please...': 'ได้โปรด...',
  'right': 'ใช่แล้ว', 'wrong': 'ผิดแล้ว', 'really': 'จริงเหรอ',
  'seriously': 'จริงจังเหรอ', 'impossible': 'เป็นไปไม่ได้',
  'unbelievable': 'เชื่อไม่ได้', 'of course': 'แน่นอน',
  // Common 2-4 word phrases
  'i see': 'เข้าใจแล้ว', 'i know': 'ฉันรู้', 'i get it': 'ฉันเข้าใจ',
  'got it': 'เข้าใจแล้ว', 'got you': 'จับได้แล้ว', 'come on': 'เร็วเข้า',
  'let go': 'ปล่อยไป', 'let me': 'ให้ฉัน', 'lets go': 'ไปกันเถอะ',
  'thank you': 'ขอบคุณ', 'no way': 'ไม่มีทาง', 'no problem': 'ไม่มีปัญหา',
  'watch out': 'ระวัง', 'calm down': 'ใจเย็นๆ', 'shut up': 'หุบปาก',
  'back off': 'ถอยออกไป', 'stand up': 'ลุกขึ้น', 'get up': 'ลุกขึ้น',
  'get out': 'ออกไป', 'get away': 'หนีออกไป', 'go away': 'ไปให้พ้น',
  'getting': 'ได้รับ', 'getting away': 'รอดตัวไปได้', 'getting away with': 'รอดตัวไปได้',
  'go on': 'ดำเนินต่อไป', 'move it': 'รีบไป', 'hurry up': 'รีบขึ้น',
  'give up': 'ยอมแพ้', 'hold on': 'รอสักครู่', 'hang on': 'รอสักครู่',
  'come here': 'มาที่นี่', 'over here': 'ที่นี่', 'over there': 'ที่นั่น',
  'thats right': 'ถูกต้อง', 'no doubt': 'ไม่ต้องสงสัย',
  'good luck': 'โชคดี', 'well done': 'เยี่ยมมาก', 'nice job': 'ทำได้ดี',
  'im sorry': 'ฉันขอโทษ', 'excuse me': 'ขอโทษนะ', 'be careful': 'ระวังด้วย',
  'dont move': 'อย่าขยับ', 'is that so': 'หรือจริงเหรอ',
  // Common manga/technical short terms
  'unit': 'หน่วย', 'units': 'หน่วย', 'all units': 'ทุกหน่วย',
  'charge': 'บุกเลย!', 'charge!': 'บุกเลย!',
  'princess': 'เจ้าหญิง', 'of all of us': 'ของพวกเราทุกคน',
  // Action words that Argos translates wrong
  'much': 'มาก', 'much...': 'มาก...', 'so much': 'มากนัก',
  'fool': 'คนโง่', 'fool...': 'คนโง่...', 'you fool': 'แกโง่ชัด',
  'sow': 'หว่าน',
  'nonstop': 'ไม่หยุด', 'non-stop': 'ไม่หยุด',
  'be': 'เป็น', 'be...': 'เป็น...',
  'more': 'อีก', 'more!': 'อีก!', 'one more': 'อีกครั้ง',
  'you!': 'แก!', 'you!?': 'แก!?',
  'oh!': 'โอ้!', 'ohhh': 'โอ้หน่อ', 'ohh': 'โอ้โห',
  'of': 'ของ', 'all': 'ทั้งหมด', 'all!': 'ทุกคน!',
  'one battle': 'การต่อสู้ครั้งหนึ่ง', 'one battle!': 'สู้แค่ครั้งเดียว!',
  'gonna die': 'จะตาย', 'gonna die!': 'จะตายแล้ว!',
  'so please': 'ดังนั้นได้โปรด', 'so please!': 'ดังนั้นได้โปรด!', 'soplease': 'ดังนั้นได้โปรด', 'soplease!': 'ดังนั้นได้โปรด!',
  'why!?': 'ทำไม!?', 'why?': 'ทำไม?',
  'ass': 'ก้น', 'ass-': 'ก้น', 'hole': 'รู', 'asshole': 'ไอ้สัตว์',
  'ass- hole': 'ไอ้สัตว์', 'ass-hole': 'ไอ้สัตว์',
  'ha!': 'ฮ่า!', 'ha ha': 'ฮ่าฮ่า', 'ha ha ha': 'ฮ่าฮ่าฮ่า',
  'hehe': 'เฮ้เฮ้', 'hehe!': 'เฮ้เฮ้!', 'hehehe': 'เฮ้เฮ้เฮ้', 'hehehe!': 'เฮ้เฮ้เฮ้!',
  'meeeeeee': 'ฉันน!', 'meeeeee': 'ฉันน!', 'meeeee': 'ฉันน!',
  'i cant believe it': 'ไมยากเชื่อเลย...', 'i cannot believe it': 'ไม่อยากเชื่อเลย...',
  'cant believe it': 'เชื่อไม่ได้เลย...', 'cannot believe it': 'เชื่อไม่ได้เลย...',
  'i cant believe it...': 'ไม่อยากเชื่อเลย...', 'i cant believe this': 'ไม่อยากเชื่อเลย',
  'her pussys so stinky': 'หีเธอช่างเหม็นตุๆ',
  'her pussy is so stinky': 'หีเธอช่างเหม็นตุๆ',
  'pussys so stinky': 'หีช่างเหม็นตุๆ',
  'with it': 'ไปด้วยกัน!',
  'cum miiinn nngg ggg': 'น้ำแตก-แล้วว วววว ววว',
  'cum miiinn nngg ggg!': 'น้ำแตก-แล้วว วววว ววว!',
  'cum miiinn nngg ggg!!': 'น้ำแตก-แล้วว วววว ววว!!',
  'cum miiinn nngg ggg!!?': 'น้ำแตก-แล้วว วววว ววว!!?',
  'cum miiinn nngg ggg!!??': 'น้ำแตก-แล้วว วววว ววว!!??',
  'when youre wildly squirting with your nipples and clit totally erect': 'เมื่อคุณกำลังหลั่งน้ำออกมาอย่างรุนแรงโดยที่หัวนมและคลิตอริสแข็งตัวเต็มที่?',
  'when youre wildly squirting with your nipples and clit totally erect?': 'เมื่อคุณกำลังหลั่งน้ำออกมาอย่างรุนแรงโดยที่หัวนมและคลิตอริสแข็งตัวเต็มที่?',
  'lets have a oneonone battle': 'มาดวลกันแบบหนึ่งต่อหนึ่งเถอะ',
  'lets have a oneonone battle!': 'มาดวลกันแบบหนึ่งต่อหนึ่งเถอะ!',
  'a oneonone battle': 'การดวลแบบหนึ่งต่อหนึ่ง',
  'a oneonone battle!': 'การดวลแบบหนึ่งต่อหนึ่ง!',
  'squiring so much as usual': 'น้ำพุ่งออกมาเยอะเหมือนเคย',
  'squirting so much as usual': 'น้ำพุ่งออกมาเยอะเหมือนเคย',
  'youre squiring so much as usual': 'น้ำพุ่งออกมาเยอะเหมือนเคย',
  'youre squirting so much as usual': 'น้ำพุ่งออกมาเยอะเหมือนเคย',
  'coooooocks': 'ควยยยยยยพวกนี้',
  'cooooocks': 'ควยยยยยยพวกนี้',
  'cooocks': 'ควยยยยยยพวกนี้',
  'coocks': 'ควยยยยยยพวกนี้',
  'cocks': 'ควยพวกนี้',
  'cock': 'ควย',
  // Manga dialogue phrases requested by the user
  'and was at a': 'และกำลังตกอยู่ใน',
  'recapturina': 'การยึดกลับคืน',
  'kina and': 'และไคนา',
  'an allout': 'อย่างเต็มรูปแบบ',
  'an all out': 'อย่างเต็มรูปแบบ',
  'a normal': 'ธรรมดา',
  'all cold': 'เย็นเฉียบ',
  'suck my': 'ดูดของฉัน',
  'cock while': 'ควยในขณะที่',
  'tangling': 'เกี่ยวกระหวัด',
  'your': 'ของคุณ',
  'tongue': 'ลิ้น',
  'onto it': 'เข้ากับมัน',
  'like the': 'เหมือนกับ',
  'pig you': 'หมูอย่างแก',
  'are': 'ที่เป็นอยู่',
  'bitch hey': 'ยัยตัวแสบ... เฮ้ย!',
  'bitch hey!': 'ยัยตัวแสบ... เฮ้ย!',
  'the pig you are': 'เหมือนหมูอย่างแก!',
  'the pig you are!': 'เหมือนหมูอย่างแก!',
  'the pig you are!!': 'เหมือนหมูอย่างแก!!',
  'pig you are': 'เหมือนหมูอย่างแก',
  'pig you are!': 'เหมือนหมูอย่างแก!',
  'pig you are!!': 'เหมือนหมูอย่างแก!!',
  'shut her up': 'หุบปากเธอซะ',
  'her up': 'หุบปากเธอซะ',
  'and shut': 'และหุบปาก',
  'what a': 'ช่าง...',
  'noisy': 'เสียงดัง',
  'bitch': 'ยัยตัวแสบ',
  'shove one': 'ยัดมันเข้าไป',
  'in her other': 'เข้าไปในอีกรูของเธอ',
  'hole too': 'ด้วยเหมือนกัน',
  'the war': 'สงคราม',
  'we deal': 'พวกเราจะจัดการเอง',
  'we deal!': 'พวกเราจะจัดการเอง!',
  'away with': 'ไปให้พ้นกับ', 'away with!': 'ไปให้พ้นกับ!',
  'away... with': 'ไปให้พ้นกับ', 'away... with!': 'ไปให้พ้นกับ!',
  // THE PiG YOU ARE,GETTING,AWAY...WiTH variants — comma-separated form from OCR
  'getting away with us the pig you are': 'รอดตัวไปได้หรอกับหมูอย่างแก',
  'getting away with us the pig you are!': 'รอดตัวไปได้หรอกับหมูอย่างแก!',
  'us the pig you are': 'ด้วยหมูอย่างแก',
  'even getting away with': 'แม้แต่จะรอดตัวไปได้กับ',
  'even getting away with!': 'แม้แต่จะรอดตัวไปได้กับ!',
  'than any': 'ยิ่งกว่าใคร',
  'than any-': 'ยิ่งกว่าใคร',
  'feelings': 'ความรู้สึก',
  'feelings!': 'ความรู้สึก!',
  'cant': 'ไม่สามารถ',
  'cant!': 'ไม่สามารถ!',
  'cant...': 'ไม่สามารถ...',
  'cant believe': 'ไม่อยากเชื่อ',
  'cant believe!': 'ไม่อยากเชื่อ!',
  'cant believe...': 'ไม่อยากเชื่อ...',
  'cannot': 'ไม่สามารถ',
  'lady roseria is dead': 'เลดี้ โรสเรีย นั้น ตายไปแล้ว',
  'lady roseria is dead!': 'เลดี้ โรสเรีย นั้น ตายไปแล้ว!',
  'lady roseria is dead!!': 'เลดี้ โรสเรีย นั้น ตายไปแล้ว!!',
  'lady roseria': 'เลดี้ โรสเรีย',
  'roseria is dead': 'โรสเรีย นั้น ตายไปแล้ว',
  'roseria is dead!': 'โรสเรีย นั้น ตายไปแล้ว!',
  'roseria is dead!!': 'โรสเรีย นั้น ตายไปแล้ว!!',
  'lady roseria is': 'เลดี้ โรสเรีย นั้น',
  'a nor mal': 'ธรรมดา',
  'duin e ospe': 'ก็เป็นช่วงเวลาที่',
  'duin espe': 'ก็เป็นช่วงเวลาที่',
  'borrm': 'กำเนิด',
  'borrm.': 'กำเนิด',
  '774': 'ทั้งหมด',
  'this my': 'นี่คือ... ของฉัน',
  'we deal with it': 'เราจะจัดการกับมันเอง',
  'we deal with it!': 'เราจะจัดการกับมันเอง!',
  // Spanish exclamations
  'joder': 'เชี่ยเอ๊ย!',
  'cono': 'บ้าเอ๊ย!',
  'coño': 'บ้าเอ๊ย!',
  'maldicion': 'แม่งเอ๊ย!',
  'maldición': 'แม่งเอ๊ย!',
  'mierda': 'ฉิบหาย!',
  'ay': 'โอ๊ย!',
  // Japanese exclamations
  'えっ': 'เอ๊ะ!',
  'えっ!': 'เอ๊ะ!',
  'えっ!?': 'เอ๊ะ!?',
  'エッ': 'เอ๊ะ!',
  'エッ!': 'เอ๊ะ!',
  'エッ!?': 'เอ๊ะ!?',
  'あっ': 'อ๊ะ!',
  'あっ!': 'อ๊ะ!',
  'はあ': 'เฮ้อ...',
  'はあ...': 'เฮ้อ...',
  'うう': 'อึ้ก...',
  'うう...': 'อึ้ก...',
  // Korean slang
  '아저씨': 'คุณลุง',
  '아줌마': 'คุณป้า',
  '씨발': 'เชี่ยเอ๊ย!',
  '헐': 'เห้ย!',
  '헐!': 'เห้ย!',
  // Korean manhwa common phrases (pre-bypass for Argos failures)
  '뭐야': 'อะไรกัน',
  '뭐야?': 'อะไรกัน?',
  '뭐야!': 'อะไรกัน!',
  '안갔지': 'ไม่ได้ไปหรอก',
  '가야해서': 'เพราะต้องไปแล้ว',
  '가야해': 'ต้องไปแล้ว',
  '왜같이': 'ทำไมถึงมาด้วยกัน',
  '잘부탁해': 'ยินดีที่ได้รู้จัก',
  '잘부탁해!': 'ยินดีที่ได้รู้จัก!',
  '잘부탁드려요': 'ยินดีที่ได้รู้จักครับ',
  '반가워': 'ยินดีที่ได้รู้จัก',
  '반가워요': 'ยินดีที่ได้รู้จักครับ',
  '엄마사촌': 'ลูกพี่ลูกน้องของแม่',
  '속마음': 'ความคิดในใจ',
  '읽지만': 'อ่านได้แต่...',
  '속마음읽지만': 'อ่านความคิดในใจได้แต่...',
  '괜찮아': 'ไม่เป็นไร',
  '괜찮아요': 'ไม่เป็นไรครับ',
  '알겠어': 'เข้าใจแล้ว',
  '알겠습니다': 'เข้าใจแล้วครับ',
  '몰라': 'ไม่รู้',
  '싫어': 'ไม่อยาก',
  '좋아': 'โอเค',
  '고마워': 'ขอบคุณ',
  '미안': 'ขอโทษ',
  '잠깐': 'เดี๋ยวก่อน',
  '잠깐만': 'แป๊บนึงนะ',
  '빨리': 'รีบๆ',
  '조심해': 'ระวังด้วย',
};


export const TRANSLATION_LETTER_REGEX = /[A-Za-z\u00C0-\u024F\u0400-\u04FF\u0E00-\u0E7F\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]/;

// -------------------------------------------------------------
// Core Translation & Retry logic
// -------------------------------------------------------------

export const lookupShortPhraseTh = (text: string): string | null => {
  const key = text.trim().toLowerCase()
    .replace(/[_]+/g, ' ')
    .replace(/[\-\/\.\,\!\?]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  
  // 1. ลองค้นหาแบบตรงตัวใน dictionary ก่อน
  const directMatch = ARGOS_SHORT_PHRASE_LOOKUP_TH[key];
  if (directMatch) return directMatch;

  // 2. ถ้าไม่พบแบบตรงตัว ลองตรวจสอบความลากเสียงยาว (Elongation) สำหรับคำการ์ตูนยอดนิยม
  // สำหรับ please (เช่น pleea +aaseee, pleeease)
  if (/^p[le]*[ea]*\s*\+?\s*[ea]*s[e]+$/i.test(key)) {
    return 'ได้โปรด ดดดดดด';
  }
  // สำหรับ more (เช่น moreeeeee)
  if (/^m[o]+r[e]+$/i.test(key)) {
    return 'มากกกกว่าาาานี้';
  }
  // สำหรับ out (เช่น ouuuut)
  if (/^[o]+[u]+[t]+$/i.test(key)) {
    return 'ออกไปปปป';
  }
  // สำหรับ knight (เช่น kniiiiight)
  if (/^k[n]+[i]+[g]+[h]+[t]+$/i.test(key)) {
    return 'อัศวิน';
  }
  // สำหรับ dead (เช่น deeead)
  if (/^d[e]+[a]+d[d]*$/i.test(key)) {
    return 'ตาย';
  }
  // สำหรับ cocks (เช่น cooooocks)
  if (/^c[o]+ck[s]*$/i.test(key)) {
    return 'ควยยยยยยพวกนี้';
  }

  return null;
};

const OFFLINE_PIVOT_SOURCE_LANGUAGES = new Set(['es', 'ko', 'ja']);

export const shouldUseOfflinePivotRoute = (sourceLanguage: string, targetLanguage: string): boolean => {
  const normalizedSource = normalizeTranslationLanguage(sourceLanguage, 'en');
  const normalizedTarget = normalizeTranslationLanguage(targetLanguage, 'th');
  return normalizedTarget === 'th' && OFFLINE_PIVOT_SOURCE_LANGUAGES.has(normalizedSource);
};

export const selectOfflinePivotCandidate = (
  sourceText: string,
  sourceLanguage: string,
  targetLanguage: string,
  directText: string,
  pivotText: string
): string => {
  const normalizedSource = normalizeTranslationLanguage(sourceLanguage, 'en');
  const normalizedTarget = normalizeTranslationLanguage(targetLanguage, 'th');
  const direct = normalizeWhitespace(String(directText || ''));
  const pivot = normalizeWhitespace(String(pivotText || ''));

  if (!pivot) return direct;
  if (!direct) return pivot;

  const directNeedsRetry = shouldRetryLineTranslation(sourceText, direct, normalizedSource, normalizedTarget);
  const pivotNeedsRetry = shouldRetryLineTranslation(sourceText, pivot, normalizedSource, normalizedTarget);
  const directStats = getTranslationScriptStats(direct);
  const pivotStats = getTranslationScriptStats(pivot);

  if (normalizedSource === 'ko' && pivotStats.thaiChars > 0) {
    const directWeak = directNeedsRetry || directStats.thaiChars === 0 || directStats.latinRatio >= 0.22;
    if (directWeak || pivotStats.thaiRatio >= directStats.thaiRatio) {
      return pivot;
    }
  }
  if (OFFLINE_PIVOT_SOURCE_LANGUAGES.has(normalizedSource) && !pivotNeedsRetry) {
    return pivot;
  }
  if (directNeedsRetry && !pivotNeedsRetry) return pivot;
  if (!directNeedsRetry && pivotNeedsRetry) return direct;

  const directScore = scoreTranslationCandidate(sourceText, direct, normalizedTarget);
  const pivotScore = scoreTranslationCandidate(sourceText, pivot, normalizedTarget);
  const pivotBias = normalizedSource === 'ko' ? 24 : (normalizedSource === 'es' ? 14 : 10);
  if (pivotScore >= directScore - pivotBias) {
    return pivot;
  }
  return directScore >= pivotScore ? direct : pivot;
};

export async function translateBatchOffline(
  texts: string[],
  type: string,
  mode: TranslationMode,
  sourceLanguage: string,
  targetLanguage: string,
  offlineBatchBridge: (texts: string[], options: any) => Promise<string[]>
): Promise<string[]> {
  if (texts.length === 0) return [];

  const normalizedSource = normalizeTranslationLanguage(sourceLanguage, 'en');
  const normalizedTarget = normalizeTranslationLanguage(targetLanguage, 'th');

  const normalizeOfflineSourceText = (rawText: string): string => {
    const text = String(rawText || '');
    if (normalizedSource === 'ko') {
      return normalizeKoreanOcrNoiseForTranslation(cleanKoreanOcrSpacing(text));
    }
    if (normalizedSource === 'ja' || normalizedSource === 'jpn' || normalizedSource === 'jpn_vert') {
      return normalizeJapaneseOcrNoiseForTranslation(cleanJapaneseOcrSpacing(text));
    }
    if (normalizedSource === 'es') {
      return normalizeSpanishOcrNoiseForTranslation(text);
    }
    if (normalizedSource === 'en') {
      return normalizeSourceForTranslation(text, 'en');
    }
    return normalizeSourceForTranslation(text, normalizedSource);
  };

  // Short-circuit lookup for known short phrases to bypass NMT and prevent translation artifacts
  const finalDirectTranslations = new Array<string>(texts.length).fill('');
  const indicesToTranslate: number[] = [];
  const textsToTranslate: string[] = [];

  for (let i = 0; i < texts.length; i++) {
    const originalText = texts[i] || '';
    const lookupResult = normalizedTarget === 'th' ? lookupShortPhraseTh(originalText) : null;
    if (lookupResult) {
      finalDirectTranslations[i] = lookupResult;
    } else {
      indicesToTranslate.push(i);
      textsToTranslate.push(originalText);
    }
  }

  if (indicesToTranslate.length === 0) {
    return finalDirectTranslations;
  }

  const preparedTexts = textsToTranslate.map((t) => {
    // Keep original case to improve NMT accuracy for English acronyms and proper nouns
    return normalizeOfflineSourceText(String(t || ''));
  });

  const isArgosUntranslated = (result: string, targetLang: string): boolean => {
    const trimmed = result.trim();
    if (!trimmed) return false;
    if (targetLang === 'th') {
      const hasThaiChars = /[\u0E00-\u0E7F]/.test(trimmed);
      const hasLatinLetters = /[a-zA-Z]/.test(trimmed);
      return hasLatinLetters && !hasThaiChars;
    }
    return false;
  };

  const cleanForRetry = (raw: string): string =>
    raw
      .replace(/[_]+/g, ' ')
      .replace(/\.{2,}/g, ' ')
      .replace(/[!?]{2,}/g, ' ')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();

  // Run Direct translation and Pivot English translation in parallel to minimize IPC latency
  const runPivotEnglish = shouldUseOfflinePivotRoute(normalizedSource, normalizedTarget);
  const directPromise = offlineBatchBridge(preparedTexts, {
    mode,
    sourceType: type,
    sourceLanguage: normalizedSource,
    targetLanguage: normalizedTarget,
  }).catch((err) => {
    console.error(`[translateBatchOffline] Direct translation call failed for ${normalizedSource}->${normalizedTarget}:`, err);
    return new Array<string>(preparedTexts.length).fill('');
  });

  const pivotEnglishPromise = runPivotEnglish
    ? offlineBatchBridge(preparedTexts, {
        mode,
        sourceType: type,
        sourceLanguage: normalizedSource,
        targetLanguage: 'en',
      }).catch((err) => {
        console.error(`[translateBatchOffline] Pivot English translation call failed for ${normalizedSource}->en:`, err);
        return new Array<string>(preparedTexts.length).fill('');
      })
    : Promise.resolve<string[]>([]);

  const [directResults, pivotEnglishResults] = await Promise.all([
    directPromise,
    pivotEnglishPromise,
  ]);

  // Merge batch direct translations back
  indicesToTranslate.forEach((originalIndex, batchIndex) => {
    finalDirectTranslations[originalIndex] = directResults[batchIndex] || '';
  });

  // Handle hybrid retry by batching the requests to reduce serial roundtrip IPC latency
  const retriesPending: Array<{ index: number; cleaned: string }> = [];

  for (let i = 0; i < indicesToTranslate.length; i++) {
    const originalIndex = indicesToTranslate[i];
    const text = directResults[i] || '';
    const untranslated = isArgosUntranslated(text, normalizedTarget);
    console.log(`[HybridRetry] i=${originalIndex} src="${preparedTexts[i]}" argosOut="${text}" untranslated=${untranslated}`);
    if (!untranslated) continue;

    const originalText = texts[originalIndex] ?? preparedTexts[i] ?? '';

    const lookupResult = normalizedTarget === 'th' ? lookupShortPhraseTh(originalText) : null;
    if (lookupResult) {
      console.log(`[HybridRetry] LOOKUP HIT: "${originalText}" → "${lookupResult}"`);
      finalDirectTranslations[originalIndex] = lookupResult;
      continue;
    }

    const cleaned = cleanForRetry(preparedTexts[i]);
    console.log(`[HybridRetry] cleaned="${cleaned}" sameAsPrepared=${cleaned === preparedTexts[i].trim()}`);
    if (cleaned && cleaned !== preparedTexts[i].trim()) {
      const cleanedLookup = normalizedTarget === 'th' ? lookupShortPhraseTh(cleaned) : null;
      if (cleanedLookup) {
        console.log(`[HybridRetry] CLEANED LOOKUP HIT: "${cleaned}" → "${cleanedLookup}"`);
        finalDirectTranslations[originalIndex] = cleanedLookup;
        continue;
      }
      retriesPending.push({ index: originalIndex, cleaned });
    } else {
      console.log(`[HybridRetry] GAVE UP (no clean retry target): "${originalText}" → returning original Argos output`);
    }
  }

  if (retriesPending.length > 0) {
    try {
      const cleanedTexts = retriesPending.map((r) => r.cleaned);
      const retryResults = await offlineBatchBridge(cleanedTexts, {
        mode,
        sourceType: type,
        sourceLanguage: normalizedSource,
        targetLanguage: normalizedTarget,
      });

      retriesPending.forEach((retry, batchIdx) => {
        const retryResult = retryResults[batchIdx] ?? '';
        const stillUntranslated = isArgosUntranslated(retryResult, normalizedTarget);
        console.log(`[HybridRetry] BATCHED ARGOS RETRY: index=${retry.index} cleaned="${retry.cleaned}" → "${retryResult}" stillUntranslated=${stillUntranslated}`);
        if (!stillUntranslated) {
          finalDirectTranslations[retry.index] = retryResult;
        } else {
          console.log(`[HybridRetry] GAVE UP (still untranslated after retry): index=${retry.index} → returning original Argos output`);
        }
      });
    } catch (_retryErr) {
      console.error('[HybridRetry] Batched retry error:', _retryErr);
    }
  }

  if (!runPivotEnglish) {
    return finalDirectTranslations;
  }

  try {
    const pivotEnglishPrepared = pivotEnglishResults.map((line, i) => {
      const normalizedPivot = normalizeSourceForTranslation(String(line || ''), 'en');
      if (normalizedPivot) return normalizedPivot;
      const originalIndex = indicesToTranslate[i];
      return normalizeOfflineSourceText(String(texts[originalIndex] || ''));
    });
    const pivotThaiResults = await offlineBatchBridge(pivotEnglishPrepared, {
      mode,
      sourceType: type,
      sourceLanguage: 'en',
      targetLanguage: normalizedTarget,
    });

    indicesToTranslate.forEach((originalIndex, i) => {
      const sourceText = texts[originalIndex] || '';
      const directCandidate = finalDirectTranslations[originalIndex];
      const pivotCandidate = pivotThaiResults[i] || '';
      finalDirectTranslations[originalIndex] = selectOfflinePivotCandidate(
        sourceText,
        normalizedSource,
        normalizedTarget,
        directCandidate,
        pivotCandidate
      );
    });

    return finalDirectTranslations;
  } catch (error) {
    console.error(`[OfflineTranslation] Pivot fallback ${normalizedSource}->en->${normalizedTarget} failed:`, error);
    return finalDirectTranslations;
  }
}

// -------------------------------------------------------------
// Translation Quality Assessment Helpers
// -------------------------------------------------------------

const ENGLISH_COMMON_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'else', 'when',
  'at', 'by', 'for', 'from', 'in', 'into', 'of', 'off', 'on', 'onto',
  'out', 'over', 'to', 'up', 'with', 'was', 'were', 'is', 'are', 'am',
  'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
  'will', 'would', 'shall', 'should', 'can', 'could', 'may', 'might',
  'must', 'go', 'went', 'gone', 'come', 'came', 'get', 'got', 'put',
  'take', 'took', 'give', 'gave', 'find', 'found', 'think', 'thought',
  'say', 'said', 'tell', 'told', 'you', 'your', 'he', 'his', 'him',
  'she', 'her', 'it', 'its', 'we', 'our', 'us', 'they', 'their', 'them',
  'who', 'whom', 'whose', 'what', 'which', 'where', 'when', 'why', 'how',
  'all', 'any', 'both', 'each', 'few', 'more', 'most', 'other', 'some',
  'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too',
  'very', 's', 't', 'don', 'just', 'shouldn', 'now',
  // Added common pronouns, interjections and common dialogue keywords
  'i', 'my', 'me', 'hey', 'oh', 'ah', 'yeah', 'like', 'dont', 'cant', 'didnt',
  'suck', 'cock', 'bitch', 'pig', 'hell', 'damn', 'ass', 'fuck', 'shit'
]);

export const shouldSkipOverlayForUntranslatedCarryOver = (
  sourceText: string,
  translatedText: string,
  targetLanguage: string
): boolean => {
  const normalizedTarget = normalizeTranslationLanguage(targetLanguage, 'th');
  if (normalizedTarget !== 'th') return false;

  const source = normalizeWhitespace(String(sourceText || ''));
  const translated = normalizeWhitespace(String(translatedText || ''));
  if (!source || !translated) return false;

  const compact = source.replace(/\s+/g, '');
  const asciiCompact = compact.replace(/[^A-Za-z0-9]/g, '');
  const isKnownShortWord = isKnownShortWordHelper(asciiCompact);
  if (isKnownShortWord) {
    return false;
  }

  // ทำไม: ถ้า source มีคำที่อยู่ใน glossary แล้วจะแปลถูกแน่นอน ไม่ควร skip ออกไป
  const glossaryLookup = lookupShortPhraseTh(source);
  if (glossaryLookup !== null) {
    return false;
  }
  
  // We check for scientific symbols or numbers
  const isScientificSymbolLikeLine = (val: string): boolean => {
    const clean = val.replace(/[\s\-_]+/g, '');
    if (!clean) return false;
    return /^[a-zA-Z0-9\(\)\[\]\{\}\+\-\*\/\\=\.,:;\u0370-\u03FF\u0400-\u04FF%]+$/.test(clean)
      && (/\d/.test(clean) || clean.length <= 4 || /^[Ff][iI][gG]/.test(clean));
  };
  
  if (isScientificSymbolLikeLine(source)) return false;

  const sourceKey = buildTranslationComparisonKey(source);
  const translatedKey = buildTranslationComparisonKey(translated);
  if (!sourceKey || !translatedKey) return false;

  const thaiChars = (translated.match(/[\u0E00-\u0E7F]/g) || []).length;
  const latinChars = (translated.match(/[A-Za-z]/g) || []).length;
  const sourceLatinChars = (source.match(/[A-Za-z]/g) || []).length;
  const tokenCount = source.split(/\s+/g).filter(Boolean).length;

  // Check for residual CJK characters in the translated output -> if CJK remains, it failed translation
  const hasCjkResidual = /[\uAC00-\uD7A3\u3040-\u30FF\u4E00-\u9FFF]/.test(translated);
  if (hasCjkResidual) {
    return true; // Skip overlay since CJK text is leaked
  }

  // Check for common watermark layouts (URLs, domain names, or scanlation watermarks)
  const isUrlOrDomain = /\.(com|net|org|io|gg|co|info|cc|to|xyz|me)\b/i.test(source)
    || /www\./i.test(source)
    || /^(?:colamanga|cloudmerge|asurascans|mangatio|likemanga|scans|newtoki)/i.test(source.replace(/[^A-Za-z0-9]/g, ''));

  // บายพาสการข้าม: หากตรวจพบว่าเป็นบทสนทนาภาษาอังกฤษทั่วไป ห้าม Skip overlay เด็ดขาด เพื่อเปิดโอกาสให้แก้ไขได้
  if (isLikelyEnglishDialogue(source) && !isUrlOrDomain) {
    return false;
  }

  // Check for pivot/NMT translation failure -> if it returned untranslated or hallucinated Latin output without any Thai chars
  const hasLatinLetters = /[a-zA-Z]/.test(translated);
  const hasThai = thaiChars > 0;
  if (hasLatinLetters && !hasThai) {
    return true; // Skip overlay directly to preserve original background image
  }

  if (thaiChars > 0) return false;

  // ทำไม: manga dialogue fragments ที่รู้จักต้องไม่โดน skip ไม่ว่า Argos จะแปลได้หรือไม่
  // เพราะ glossary จะ override ผลการแปลที่ถูกต้องอยู่แล้ว
  const compactUpper = source.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const KNOWN_MANGA_PHRASES = /^(?:THENTRYANDHOLDBACKYOURORGASMYOUPIG|KILLME|WITHPROCREATION|NIPPLES|SUDDENLY|BUT|FORMAMEDICAL|WAYTOOGOOD|BEINGTOO|FROMTHE|ITFEELS|OUTINSIDE|STILLFULL|ILLNESSBE|WELLSINCE|RESTA|THESEX|BLOWJOB|NURSE|OFME|EROMANGA|OFMEEROMANGA|ITWITHOUT|HEADNURSE|HEADNURS\w+|DISEASE|FOUNDA|RESTRAINT|HERPUSSY|CUMMING|WAYTOO|NOTNECESSARY|ADYDO|PLEASE|YQURE|WIDLY|SIDESHOW|CAME|COOOOOOCKS|COOOOOCKS|COOOOCKS|COOOCKS|COOCKS|COCKS|ONEONONE|CUMALOTJUSTLIKETHAT|GONNADIE|TOBEDEADNOW|ONEBATTLE|SOPLEASE|NONSTOP|HEHEHE|MEEEEEEE|MEEEEEE|MEEEEE|WITHIT|FRONT|KNIGHT|KNIIIGHT|KNIIIIGHT|KNIIIIIGHT|KNIIIIIIGHT|YOURE|USTHE|HES|GET|CUM|II|NIPPLES|LONGER|TODAYAGAIN|HERPOSI|HERPOSITION|SUITS|SO|NIPPLESAND|CERVIX|GENERAL|DIEALONG|ALSO|HERPLACE|MAKESURE|SADNESS|ALLARSTOCRATS|ALLARISTOCRATS|KINGAND|BUTINANYAGE|DEAD|OUUUUT|MOREEEEEE|PLEEAAASEEE|RECAPTURING|ANALLOUT|IFI|TOYEDWITH|ANDWASATA|EXPECT|ANDHER|YOUFRONTUSTHEGETTINGAWAYWITH)$/i.test(compactUpper);
  if (KNOWN_MANGA_PHRASES) return false;

  if (sourceKey === translatedKey) {
    const wordsList = source.toLowerCase().split(/[^a-z]+/g).filter(Boolean);
    const hasCommonWord = wordsList.some(w => ENGLISH_COMMON_WORDS.has(w));
    if (hasCommonWord) {
      return false;
    }
    // Check for common watermark layouts (URLs, domain names, or scanlation watermarks)
    const isUrlOrDomain = /\.(com|net|org|io|gg|co|info|cc|to|xyz|me)\b/i.test(source)
      || /www\./i.test(source)
      || /^(?:colamanga|cloudmerge|asurascans|mangatio|likemanga|scans|newtoki)/i.test(source.replace(/[^A-Za-z0-9]/g, ''));

    const threshold = isUrlOrDomain ? 8 : 18;
    return tokenCount >= 1 && (sourceLatinChars >= threshold || source.length >= threshold);
  }

  // เพิ่ม threshold: >= 6 แทน >= 4 เพื่อป้องกัน multi-word dialogue fragments โดน skip
  return latinChars >= 6 && sourceLatinChars >= 6 && tokenCount >= 3;
};

export const buildTranslationComparisonKey = (value: string): string =>
  normalizeWhitespace(String(value || ''))
    .toLowerCase()
    .replace(/[^a-z0-9\u00C0-\u024F\u0400-\u04FF\u0E00-\u0E7F\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]+/g, '');

export const countReadableLength = (text: string): number => {
  const compact = text.replace(/\s+/g, ' ').trim();
  return compact.length;
};

const SENTENCE_END_REGEX = /[.!?\u2026\u3002\uFF01\uFF1F]$/;
export const isStrongSentenceEnd = (text: string): boolean => {
  const compact = text.trim();
  if (!compact) return false;
  return SENTENCE_END_REGEX.test(compact);
};

const SOFT_CONTINUATION_END_REGEX = /[,;:\-\u2014\u2013\u3001\uFF0C]$/;
const CONTINUATION_TRAILING_WORD_REGEX = /\b(?:a|an|the|of|to|for|and|or|but|if|when|while|with|without|into|onto|from|by|as|than|that|this|these|those|my|your|his|her|its|our|their|is|are|was|were|be|been|being|do|does|did|have|has|had|can|could|will|would|should|must|may|might|not|so|up|off|out|over|under|about|around|through|toward|towards)$/i;
const CONTINUATION_LEADING_WORD_REGEX = /^(?:and|or|but|if|when|while|because|that|which|who|whose|whom|to|for|of|with|as|than|then|so|also|still|yet|just)\b/i;

export const isLikelyContinuation = (previousText: string, currentText: string): boolean => {
  const prev = previousText.trim();
  const curr = currentText.trim();
  if (!prev || !curr) return false;

  if (SOFT_CONTINUATION_END_REGEX.test(prev)) return true;
  if (/[\-\u2013\u2014]$/.test(prev)) return true;
  if (CONTINUATION_TRAILING_WORD_REGEX.test(prev)) return true;
  if (/^[,;:.)\]\}"'\u3001\uFF0C]/.test(curr)) return true;
  if (/^[a-z]/.test(curr)) return true;
  if (CONTINUATION_LEADING_WORD_REGEX.test(curr)) return true;
  return false;
};

export const isLikelyStandaloneInterjectionLine = (text: string): boolean => {
  const normalized = normalizeWhitespace(String(text || ''));
  if (!normalized) return false;

  const compact = normalized.replace(/\s+/g, '');
  const tokens = normalized.split(/\s+/g).filter(Boolean);
  if (compact.length > 16 || tokens.length > 3) return false;

  if (/^[A-Za-z]-[A-Za-z][A-Za-z'’!?….-]{0,12}$/.test(compact)) {
    return true;
  }

  const trailingPunct = /[!?…]{1,3}$/.test(compact);
  const latinLetters = compact.replace(/[^A-Za-z]/g, '').length;
  if (trailingPunct && latinLetters > 0 && latinLetters <= 8 && tokens.length <= 2) {
    return true;
  }

  const nonLatin = compact.replace(/[\u0E00-\u0E7F\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF]/g, '').length !== compact.length;
  if (trailingPunct && nonLatin && compact.length <= 7) {
    return true;
  }

  return false;
};

export const collapseRepeatedTranslationFragments = (text: string): string => {
  const normalized = normalizeWhitespace(String(text || ''));
  if (!normalized) return normalized;

  const dedupHesitation = normalized.replace(
    /(A-?\s*Are\s+you)(?:\s+\1)+/gi,
    '$1'
  );
  if (dedupHesitation !== normalized) {
    return normalizeWhitespace(dedupHesitation);
  }

  const repeatedChunk = normalized.match(/^(.{4,}?)(?:\s+\1)+$/u);
  if (repeatedChunk?.[1]) {
    return normalizeWhitespace(repeatedChunk[1]);
  }

  const tokens = normalized.split(/\s+/g).filter(Boolean);
  if (tokens.length >= 4 && tokens.length % 2 === 0) {
    const half = tokens.length / 2;
    const firstHalf = tokens.slice(0, half).join(' ');
    const secondHalf = tokens.slice(half).join(' ');
    if (firstHalf === secondHalf) {
      return firstHalf;
    }
  }

  if (tokens.length >= 6) {
    const normalizeTokenSpan = (spanTokens: string[]): string =>
      spanTokens
        .join(' ')
        .toLowerCase()
        .replace(/[^a-z0-9\u00C0-\u024F\u0400-\u04FF\u0E00-\u0E7F\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]+/giu, '');

    const maxSpan = Math.min(8, Math.floor(tokens.length / 2));
    for (let span = maxSpan; span >= 2; span -= 1) {
      const firstSpan = tokens.slice(0, span);
      const secondSpan = tokens.slice(span, span * 2);
      if (secondSpan.length < span) continue;

      const firstKey = normalizeTokenSpan(firstSpan);
      const secondKey = normalizeTokenSpan(secondSpan);
      if (!firstKey || firstKey.length < 6) continue;
      if (firstKey !== secondKey) continue;

      const merged = [...firstSpan, ...tokens.slice(span * 2)].join(' ');
      return normalizeWhitespace(merged);
    }
  }

  return normalized;
};

// -------------------------------------------------------------
// Layout, Grouping & Persist Flag Helpers
// -------------------------------------------------------------

const DOCUMENT_SOURCE_HINT_REGEX = /\b(chapter|table|fig(?:ure)?\.?|reaction|unknowns?|equilibrium|rigid|body|support|diagram|objective|objectives|connection|connections|continued|force|moment|component|unknown|column|columns|bridge|building|beam|beams|welded|surface|bracket|cable|utility|floor|member|pin|hinge)\b/i;

export const shouldUseDocumentCoverageFallback = (sourceText: string): boolean => {
  const normalized = normalizeOverlayInlineText(String(sourceText || ''));
  if (!normalized) return false;
  const wordCount = normalized.split(/\s+/g).filter(Boolean).length;
  const thaiCharCount = (normalized.match(/[\u0E00-\u0E7F]/g) || []).length;
  const technicalLike = DOCUMENT_SOURCE_HINT_REGEX.test(normalized);
  const numericDocumentLike = wordCount >= 6 && /[0-9()\-]/.test(normalized);
  const thaiDocumentLike = thaiCharCount >= 12
    && (wordCount >= 3 || /[0-9()\[\].,:;\-]/.test(normalized));
  return technicalLike || numericDocumentLike || thaiDocumentLike;
};

export const clampOverlayTypographyScale = (value: number): number => {
  if (!Number.isFinite(value)) return 1;
  if (value < 0.7) return 0.7;
  if (value > 1.6) return 1.6;
  return value;
};

export const scaleOverlayTypography = (typography: OverlayTypography, scale: number): OverlayTypography => {
  const normalizedScale = clampOverlayTypographyScale(scale);
  if (Math.abs(normalizedScale - 1) < 0.0001) return typography;

  return {
    ...typography,
    fontSize: Math.max(8, Number((typography.fontSize * normalizedScale).toFixed(2))),
    lineHeight: Number((typography.lineHeight * normalizedScale).toFixed(3)),
    padX: Math.max(1, Math.round(typography.padX * normalizedScale)),
    padY: Math.max(1, Math.round(typography.padY * normalizedScale)),
    contentHeight: Math.max(1, Number((typography.contentHeight * normalizedScale).toFixed(2))),
  };
};

export const readPersistedBooleanFlag = (key: string, defaultValue: boolean): boolean => {
  if (typeof window === 'undefined') return defaultValue;
  try {
    const raw = String(window.localStorage.getItem(key) || '').trim().toLowerCase();
    if (!raw) return defaultValue;
    if (raw === '0' || raw === 'false' || raw === 'off') return false;
    if (raw === '1' || raw === 'true' || raw === 'on') return true;
    return defaultValue;
  } catch {
    return defaultValue;
  }
};

export const isBalloonAwareGroupingEnabled = (storageKey: string = 'pdf_translator_balloon_aware_grouping'): boolean =>
  readPersistedBooleanFlag(storageKey, true);

export const isLayoutGroupingDebugEnabled = (storageKey: string = 'pdf_translator_layout_grouping_debug'): boolean =>
  readPersistedBooleanFlag(storageKey, false);

export const resolveOverlayExportScale = (
  visibleWidth: number,
  visibleHeight: number,
  sourceWidth: number,
  sourceHeight: number
): number => {
  const safeVisibleWidth = Math.max(1, visibleWidth);
  const safeVisibleHeight = Math.max(1, visibleHeight);
  const safeSourceWidth = Math.max(1, sourceWidth);
  const safeSourceHeight = Math.max(1, sourceHeight);
  const sourceRatio = Math.max(safeSourceWidth / safeVisibleWidth, safeSourceHeight / safeVisibleHeight);
  const deviceRatio = typeof window !== 'undefined' ? Math.max(1, window.devicePixelRatio || 1) : 1;

  return Math.min(3, Math.max(1.5, deviceRatio, sourceRatio));
};

// -------------------------------------------------------------
// App Quality Gates & Advanced Logic Helpers
// -------------------------------------------------------------

export const shouldRetryLineTranslation = (
  sourceText: string,
  translatedText: string,
  sourceLanguage: string,
  targetLanguage: string
): boolean => {
  const source = normalizeWhitespace(String(sourceText || ''));
  if (!source) return false;
  if (!TRANSLATION_LETTER_REGEX.test(source)) return false;

  const translated = normalizeWhitespace(String(translatedText || ''));
  if (!translated) return true;

  // Bypass low-quality retry classification for normal English dialogue/narrative
  const wordsList = source.toLowerCase().split(/[^a-z]+/g).filter(Boolean);
  const hasCommonWord = wordsList.some(w => ENGLISH_COMMON_WORDS.has(w));
  if (hasCommonWord) {
    return false;
  }

  const isUrlOrDomain = /\.(com|net|org|io|gg|co|info|cc|to|xyz|me)\b/i.test(source)
    || /www\./i.test(source)
    || /^(?:colamanga|cloudmerge|asurascans|mangatio|likemanga|scans|newtoki)/i.test(source.replace(/[^A-Za-z0-9]/g, ''));
  const threshold = isUrlOrDomain ? 8 : 18;
  if (source.length < threshold && !isUrlOrDomain) {
    return false;
  }

  const sourceKey = buildTranslationComparisonKey(source);
  const translatedKey = buildTranslationComparisonKey(translated);
  if (sourceKey && translatedKey && sourceKey === translatedKey) {
    return true;
  }

  const normalizedSource = normalizeTranslationLanguage(sourceLanguage, 'en');
  const normalizedTarget = normalizeTranslationLanguage(targetLanguage, 'th');

  if (normalizedTarget === 'th') {
    const letterChars = translated.match(/[A-Za-z\u0E00-\u0E7F]/g) || [];
    const latinChars = translated.match(/[A-Za-z]/g) || [];
    const thaiChars = translated.match(/[\u0E00-\u0E7F]/g) || [];
    const latinRatio = latinChars.length / Math.max(1, letterChars.length);

    // 1) Looks mostly untranslated Latin/English
    const looksUntranslatedLatin = letterChars.length >= 10 && latinRatio >= 0.62 && thaiChars.length <= 2;
    if (looksUntranslatedLatin) {
      return true;
    }

    // 2) Short mostly Latin carry-over
    const sourceLatinChars = source.match(/[A-Za-z]/g) || [];
    const translatedAlphaChars = translated.match(/[A-Za-z\u0E00-\u0E7F]/g) || [];
    const translatedHasNoThai = thaiChars.length === 0;
    const mostlyLatinShortCarryOver = translatedHasNoThai
      && sourceLatinChars.length >= 4
      && translatedAlphaChars.length >= Math.min(4, sourceLatinChars.length)
      && latinRatio >= 0.78;
    if (mostlyLatinShortCarryOver) {
      return true;
    }

    // 3) Mixed carry-over (partially translated but with too much English leftovers)
    const mixedCarryOver = sourceLatinChars.length >= 8
      && thaiChars.length >= 1
      && translatedAlphaChars.length >= 10
      && latinRatio >= 0.4;
    if (mixedCarryOver) {
      return true;
    }

    // 4) High English ratio in mid-to-long sentences with very few Thai characters
    const highLatinRatioShortThai = letterChars.length >= 8
      && latinRatio >= 0.35
      && thaiChars.length < 4;
    if (highLatinRatioShortThai) {
      return true;
    }

    // 5) Sentence is reasonably long in source but translated to extremely short garbage Thai
    const sourceLetters = source.replace(/[^A-Za-z]/g, '').length;
    if (sourceLetters >= 15 && thaiChars.length > 0 && thaiChars.length <= 3) {
      return true;
    }

    // 6) Translated text contains visible raw OCR noise remnants
    const containsOcrNoiseTrash = /([lI1|]{3,}|ll\|l|I\|I|ll\|ll|\/\\|\\\/)/gi.test(translated);
    if (containsOcrNoiseTrash && thaiChars.length <= 4) {
      return true;
    }

    const hasKnownOcrNoisePattern = (val: string): boolean => {
      const clean = val.replace(/[\s\-_]+/g, '');
      return /^[|¦│┃￨︱︲/\\_~.,:;'"`!?-]+$/.test(clean);
    };

    if (hasKnownOcrNoisePattern(source) && thaiChars.length === 0) {
      return true;
    }
  }

  if (normalizedSource === 'ko' && normalizedTarget === 'th') {
    if (hasKoreanTranslationCarryover(translated)) {
      return true;
    }
  }

  return false;
};

export const getTranslationScriptStats = (text: string): {
  thaiChars: number;
  latinChars: number;
  letterChars: number;
  latinRatio: number;
  thaiRatio: number;
} => {
  const normalized = normalizeWhitespace(String(text || ''));
  const thaiChars = (normalized.match(/[\u0E00-\u0E7F]/g) || []).length;
  const latinChars = (normalized.match(/[A-Za-z]/g) || []).length;
  const letterChars = thaiChars + latinChars;
  return {
    thaiChars,
    latinChars,
    letterChars,
    latinRatio: latinChars / Math.max(1, letterChars),
    thaiRatio: thaiChars / Math.max(1, letterChars),
  };
};

export const scoreTranslationCandidate = (
  sourceText: string,
  candidateText: string,
  targetLanguage: string
): number => {
  const source = normalizeWhitespace(String(sourceText || ''));
  const candidate = normalizeWhitespace(String(candidateText || ''));
  if (!candidate || !source) return 0;

  const normalizedTarget = normalizeTranslationLanguage(targetLanguage, 'th');
  const sourceLength = source.length;
  const candidateLength = candidate.length;

  if (normalizedTarget === 'th') {
    const stats = getTranslationScriptStats(candidate);
    const hasThai = stats.thaiChars > 0;
    if (!hasThai) {
      return -100; // Penalize candidate heavily if it contains absolutely no Thai characters
    }

    let score = candidateLength * 0.1;

    // 1) Length balance check
    const lengthRatio = candidateLength / Math.max(1, sourceLength);
    if (lengthRatio >= 0.5 && lengthRatio <= 1.8) {
      score += 20; // Ideal length balance bonus
    } else if (lengthRatio >= 0.35 && lengthRatio <= 2.3) {
      score += 10; // Acceptable length balance bonus
    } else if (lengthRatio < 0.22 && sourceLength >= 12) {
      score -= 30; // Heavy penalty for overly truncated translation
    }

    // 2) Thai purity and density metrics
    score += stats.thaiRatio * 30;
    if (stats.latinChars === 0) {
      score += 25; // Bonus for high quality pure Thai without Latin pollution
    } else {
      score -= stats.latinRatio * 35; // Penalize Latin pollution ratio
    }

    // 3) OCR noise leftovers penalty
    const hasOcrTrash = /([lI1|]{3,}|ll\|l|I\|I|ll\|ll|\/\\|\\\/|..|_)/gi.test(candidate);
    if (hasOcrTrash) {
      score -= 40;
    }

    return score;
  }

  return candidateLength * 0.1;
};

export const evaluateUntranslatedTranslation = (
  lines: Array<{ index: number; text: string }>,
  translatedByIndex: Map<number, string>,
  sourceLanguage: string,
  targetLanguage: string
): { shouldSkip: boolean; retryRatio: number; thaiRatio: number; total: number } => {
  const normalizedTarget = normalizeTranslationLanguage(targetLanguage, 'th');
  if (normalizedTarget !== 'th') {
    return { shouldSkip: false, retryRatio: 0, thaiRatio: 0, total: 0 };
  }

  let total = 0;
  let retryCount = 0;
  let thaiChars = 0;
  let letterChars = 0;

  lines.forEach((line) => {
    const translated = translatedByIndex.get(line.index) || '';
    total += 1;
    if (shouldRetryLineTranslation(line.text, translated, sourceLanguage, normalizedTarget)) {
      retryCount += 1;
    }
    const stats = getTranslationScriptStats(translated);
    thaiChars += stats.thaiChars;
    letterChars += stats.letterChars;
  });

  if (total < 4) {
    return { shouldSkip: false, retryRatio: 0, thaiRatio: 0, total };
  }

  const retryRatio = retryCount / Math.max(1, total);
  const thaiRatio = thaiChars / Math.max(1, letterChars);
  const shouldSkip = retryRatio >= 0.65 && thaiRatio < 0.06;
  return { shouldSkip, retryRatio, thaiRatio, total };
};

export const evaluateThaiCarryoverForEnglish = (
  groups: Array<{ sourceText: string }>,
  translatedGroups: string[],
  targetLanguage: string
): { shouldFallback: boolean; thaiRatio: number; carryoverRatio: number; total: number } => {
  const normalizedTarget = normalizeTranslationLanguage(targetLanguage, 'en');
  if (normalizedTarget !== 'en') {
    return { shouldFallback: false, thaiRatio: 0, carryoverRatio: 0, total: 0 };
  }

  let total = 0;
  let carryoverCount = 0;
  let thaiChars = 0;
  let letterChars = 0;

  groups.forEach((group, i) => {
    const translated = translatedGroups[i] || '';
    total += 1;
    
    // If target is English, translated text should contain minimal Thai
    const stats = getTranslationScriptStats(translated);
    const hasThai = stats.thaiChars > 0;
    if (hasThai && stats.thaiRatio >= 0.3) {
      carryoverCount += 1;
    }
    thaiChars += stats.thaiChars;
    letterChars += stats.letterChars;
  });

  if (total === 0) {
    return { shouldFallback: false, thaiRatio: 0, carryoverRatio: 0, total };
  }

  const carryoverRatio = carryoverCount / total;
  const thaiRatio = thaiChars / Math.max(1, letterChars);
  const shouldFallback = carryoverRatio >= 0.5 && thaiRatio >= 0.25;
  return { shouldFallback, thaiRatio, carryoverRatio, total };
};

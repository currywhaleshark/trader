/**
 * 한국어 조사 고르기. "과일이(가)", "미라포(으)로" 같은 표기를 앞 글자의 받침에 맞게 바꾼다.
 * 이름이 데이터에서 오기 때문에 문장을 만들 때는 겹표기로 쓰고, 화면에 보이기 직전에 이 함수를 거친다.
 */

/** 숫자를 읽을 때의 받침: 0 영(ㅇ) 1 일(ㄹ) 2 이 3 삼(ㅁ) 4 사 5 오 6 육(ㄱ) 7 칠(ㄹ) 8 팔(ㄹ) 9 구 */
const DIGIT_JONG = [21, 8, 0, 16, 0, 0, 1, 8, 8, 0];

/** 마지막 글자의 받침 번호(0 = 받침 없음, 8 = ㄹ). 한글·숫자가 아니면 0. */
function finalJong(word: string): number {
  for (let i = word.length - 1; i >= 0; i--) {
    const ch = word[i];
    const code = ch.charCodeAt(0);
    if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28;
    if (ch >= '0' && ch <= '9') return DIGIT_JONG[code - 48];
    if (ch === '%') return 0; // 퍼센트
    if (ch === ',' || ch === ' ') continue;
    return 0;
  }
  return 0;
}

const PATTERN = /([가-힣0-9%]+)(이\(가\)|을\(를\)|은\(는\)|과\(와\)|와\(과\)|\(으\)로|\(이\)라고)/g;

export function fixJosa(text: string): string {
  return text.replace(PATTERN, (_m, word: string, pair: string) => {
    const jong = finalJong(word);
    const has = jong !== 0;
    switch (pair) {
      case '이(가)':
        return word + (has ? '이' : '가');
      case '을(를)':
        return word + (has ? '을' : '를');
      case '은(는)':
        return word + (has ? '은' : '는');
      case '과(와)':
      case '와(과)':
        return word + (has ? '과' : '와');
      case '(으)로':
        return word + (has && jong !== 8 ? '으로' : '로');
      case '(이)라고':
        return word + (has ? '이라고' : '라고');
      default:
        return word + pair;
    }
  });
}

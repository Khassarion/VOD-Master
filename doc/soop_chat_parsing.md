# SOOP 다시보기 채팅 로그(GetChatLog) 파싱

`SoopPrevChatViewer`(`src/module/soop_prev_chat_viewer.js`)가 VOD 다시보기에서 "이전 채팅 복원" 시 `SoopAPI.GetChatLog`로 받아오는 XML을 어떻게 해석하는지 정리한 문서. 실제 채팅창 표시와 대조해서 역추적한 내용이라 **100% 공식 스펙은 아니고, 지금까지 확인된 범위에서만 보장됨**. 불확실한 부분은 6번 항목에 따로 적어뒀다.

## 1. XML 구조

```xml
<root>
  <chat>...</chat>   <!-- 일반 채팅 -->
  <ogq>...</ogq>     <!-- OGQ 이모티콘 -->
  <balloon>...</balloon>           <!-- 미사용: 풍선(후원) 이벤트 -->
  <challenge_mission>...</challenge_mission>  <!-- 미사용: 미션/후원 이벤트 -->
</root>
```

파서(`parseChatLogXmlRaw`)는 `root > chat, root > ogq`만 순회한다. `balloon`, `challenge_mission`은 채팅 목록에 표시되는 요소가 아니라서 무시한다.

## 2. 필드 레퍼런스

| 태그 | 의미 | 사용 위치 |
|---|---|---|
| `m` | 메시지 본문 | `msg` |
| `t` | 방송 시작 기준 경과 시간(초, 소수점 포함) | `timestamp` (ms로 변환, 정렬 키) |
| `u` | 유저 ID. `닉네임(N)` 형태로 등급 숫자가 붙을 수 있음(예: `agnese24(2)`) | `userId` |
| `n` | 유저 닉네임(CDATA) | `userNick` |
| `p` | **권한/배지 비트마스크** (아래 3번) | `badgeType`, `gradeValue` 계산 |
| `p2` | 구독 티어 비트마스크 (아래 5번) | `subscriptionTier` |
| `nf` | 닉네임 색상(라이트 모드, hex) | `nicknameColor` |
| `nd` | 닉네임 색상(다크 모드로 추정) | **미사용** — 코드가 참조하지 않음 |
| `acfw` | 구독 개월수. `-1`이면 구독자 아님 | `subscriptionMonths`, 퍼스나콘/등급 계산 |
| `fw` | 팬 등급(펫, 레벨 등으로 추정) | **미사용** |
| `ext` | `key=value&key=value` 형태 CDATA. `fw=..&afw=..` 기본, 월간 열혈팬이면 앞에 `tfm=11&tfr=N` 추가 | `badgeType` (월간 열혈팬 판별) |
| `c`, `mt`, `l`, `pn`, `tlk` | XML에 존재하나 의미 미확인, 현재 미사용 | - |

OGQ(`ogq` 태그)는 필드 이름이 다르다: `s`→`userId`, `sn`→`userNick`, `sf`(`유저p|p2` 형태)→`p`/`p2`, `gid`+`sid`+`v`+`anm`→이모티콘 이미지 URL/구매 링크 조합.

## 3. 배지(`badgeType`) 판별 — `getBadgeType(pValue, extValue)`

`p`는 32bit 비트마스크다. 지금까지 확인된 비트:

| 비트(hex) | 의미 | 뱃지 |
|---|---|---|
| `0x40` | 매니저 | `manager` (최우선) |
| `0x8000` | **누적 열혈팬** | `vip` |
| `0x20` | 팬클럽 | `subscribe` |
| `0x100000` | 서포터 | `support` |

여기에 **월간 열혈팬**은 `p`가 아니라 `ext` 필드의 `tfm=11` 파라미터로 판별한다(`tfr`은 그 달의 열혈팬 순위로 추정, 예: `tfr=3` → 3위). `p`의 열혈팬 비트와 `ext`의 `tfm`은 서로 독립이라 4가지 조합이 전부 가능하다:

| 누적(`0x8000`) | 월간(`tfm=11`) | 결과 |
|---|---|---|
| ✗ | ✗ | 해당 없음 (팬클럽 등 다른 뱃지로 판정) |
| ✓ | ✗ | `vip` — "열혈팬" |
| ✗ | ✓ | `vip-monthly` — "월간 열혈팬" |
| ✓ | ✓ | `vip-both` — "누적 · 월간 열혈팬" |

우선순위는 `manager > (vip/vip-monthly/vip-both) > subscribe > support`.

> 이 규칙은 실제 채팅창에 표시된 13명(누적만/월간만/둘다/팬클럽만 전부 포함)과 비교해서 확인했다. 다만 `tfm`이 `11` 외의 값을 가질 수 있는지는 확인 못 함 — 지금까지는 항상 `11`만 관측됨.

## 4. `gradeValue` 계산 — `getGradeValue(pValue, subscriptionMonths)`

채팅 DOM의 `grade` 속성값(SOOP 자체 CSS가 참조):

- 구독자(`acfw !== -1`) → `6`
- 비구독자인데 팬클럽/열혈팬 비트(`p & 0x20`) 있음 → `3`
- 둘 다 아님 → `5`

열혈팬 비트(`0x8000`)나 `tfm`은 이 계산에 들어가지 않는다 — 팬클럽 비트(`0x20`)만 본다.

## 5. 구독 티어/퍼스나콘

- `p2 & 0x80000` → 있으면 **구독플러스**(tier 2), 없으면 **일반구독**(tier 1).
- `acfw`(개월수) + 티어로 `getPersonalconUrl`에서 퍼스나콘 이미지를 고른다 (개월수 이하 중 가장 큰 구간 매칭).

## 6. 확인이 더 필요한 부분

- `tfm=11`이 "월간 열혈팬"을 뜻하는 고정값인지, 다른 월간 등급에서 다른 숫자가 나올 수 있는지 불명확.
- `c`, `mt`, `l`, `pn`, `tlk`, `nd`, `fw`(최상위) 필드는 의미를 특정하지 못해서 현재 아무 로직에도 쓰이지 않음. 추후 다른 뱃지/표시가 추가되면 이 필드들부터 의심해볼 것.

import { IVodSync } from './interface4log.js';

export class SoopPrevChatViewer extends IVodSync {
    constructor() {
        super();
        this.restoreButton = null;
        this.settingsButton = null;
        this.buttonContainer = null;
        this.chatMemo = null; // chatMemo 참조 저장 (복구된 채팅 추가용)
        this.boxVstart = null; // boxVstart 참조 저장 (채팅 초기화 감지용)
        this.settingsPopup = null;
        this.isRestoring = false;
        this.checkInterval = null;
        // 복원 구간: startTime/endTime (playbackTime 기준)
        this._restoreTimeRange = null;
        this.vodInfo = null; // VOD 정보 캐시
        this.signatureEmoticon = null; // 시그니처 이모티콘 데이터 캐시
        this.defaultEmoticon = null; // 기본 이모티콘 데이터 캐시
        this.emoticonReplaceMap = new Map(); // 이모티콘 ID -> 이미지 HTML 매핑
        this.restoreInterval = 30; // 복원 구간 단위 (초)
        this.soopBuiltInRestoreSeconds = 30; // SOOP 공식 패치가 재생 시점 변경 시 자동 복원해주는 구간 (초)
        this.excludeEmoticonOnlyChat = false; // 이모티콘만으로 이루어진 채팅 복원 제외 여부
        this.autoRestoreEnabled = false; // 버튼 생성 시 1회 자동 복원 여부
        this.autoRestorePeriod = 30; // 자동 복원 시 불러올 구간 (초)
        this.initialRestoreEndTime = null; // statVBox 재생성 시점의 복구 끝지점 (playbackTime, 초 단위)
        this.sharedTooltip = null; // 재사용할 공통 툴팁 요소
        this._tooltipHideTimeout = null; // 툴팁 mouseleave 시 지연 숨김용
        this._soopUrls = window.VODSync?.SoopUrls || {};
        this.log('loaded');
        this.loadRestoreInterval();
        this.init();
    }

    // restoreTimeRange getter/setter (setter에서 자동으로 버튼 텍스트 업데이트)
    get nextRestorePlan() {return this._restoreTimeRange;}

    set nextRestorePlan(value) {
        this._restoreTimeRange = value;
        this.updateButtonText();
    }

    // 설정에서 복원 구간 불러오기
    async loadRestoreInterval() {
        // 크롬 확장 프로그램 환경에서만 설정 로드 (탬퍼몽키가 아닌 경우)
        if (window.VODSync?.IS_TAMPER_MONKEY_SCRIPT === true) {
            return;
        }
        try {
            const response = await chrome.runtime.sendMessage({ action: 'getAllSettings' });
            if (response && response.success && response.settings) {
                const interval = response.settings.soopRestoreInterval;
                if (interval !== undefined) {
                    this.restoreInterval = interval;
                    this.log(`복원 구간 설정 로드: ${interval}초`);
                }
                if (response.settings.soopExcludeEmoticonOnlyChat !== undefined) {
                    this.excludeEmoticonOnlyChat = response.settings.soopExcludeEmoticonOnlyChat;
                    this.log('이모티콘만 복원 제외 설정 로드:', this.excludeEmoticonOnlyChat);
                }
                if (response.settings.soopAutoRestoreChat !== undefined) {
                    this.autoRestoreEnabled = response.settings.soopAutoRestoreChat;
                    this.log('자동 복원 설정 로드:', this.autoRestoreEnabled);
                }
                if (response.settings.soopAutoRestorePeriod !== undefined) {
                    this.autoRestorePeriod = response.settings.soopAutoRestorePeriod;
                    this.log(`자동 복원 구간 설정 로드: ${this.autoRestorePeriod}초`);
                }
            }
        } catch (error) {
            this.log('복원 구간 설정 로드 실패:', error);
        }
    }

    // 복원 구간 설정 저장
    async saveRestoreInterval() {
        // 크롬 확장 프로그램 환경에서만 설정 저장 (탬퍼몽키가 아닌 경우)
        if (window.VODSync?.IS_TAMPER_MONKEY_SCRIPT === true) {
            return;
        }
        try {
            const response = await chrome.runtime.sendMessage({
                action: 'saveSettings',
                settings: {
                    soopRestoreInterval: this.restoreInterval,
                    soopExcludeEmoticonOnlyChat: this.excludeEmoticonOnlyChat,
                    soopAutoRestoreChat: this.autoRestoreEnabled,
                    soopAutoRestorePeriod: this.autoRestorePeriod
                }
            });
            if (response && response.success) {
                this.log(`복원 구간 설정 저장: ${this.restoreInterval}초, 이모티콘만 제외: ${this.excludeEmoticonOnlyChat}, 자동 복원: ${this.autoRestoreEnabled} (${this.autoRestorePeriod}초)`);
            }
        } catch (error) {
            this.log('복원 구간 설정 저장 실패:', error);
        }
    }

    init() {
        // 공통 툴팁 요소 생성
        this.sharedTooltip = document.createElement('div');
        this.sharedTooltip.className = 'vodsync-chat-tooltip';
        this.sharedTooltip.style.cssText = `
            position: fixed;
            padding: 4px 8px;
            background: rgba(0, 0, 0, 0.85);
            color: white;
            border-radius: 4px;
            font-size: 12px;
            white-space: nowrap;
            pointer-events: none;
            opacity: 0;
            transition: opacity 0.1s;
            z-index: 10000;
        `;
        // 툴팁 클릭 시 해당 시점으로 이동 (툴팁만 클릭 가능하도록 여기서만 처리)
        this.sharedTooltip.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const sec = this.sharedTooltip.dataset.playbackTimeSeconds;
            if (sec === undefined || sec === '') return;
            const playbackTimeSeconds = parseInt(sec, 10);
            const tsManager = window.VODSync?.tsManager;
            if (tsManager && typeof tsManager.moveToPlaybackTime === 'function') {
                tsManager.moveToPlaybackTime(playbackTimeSeconds, true);
            }
            this.sharedTooltip.style.opacity = '0';
            this.sharedTooltip.style.pointerEvents = 'none';
        });
        this.sharedTooltip.addEventListener('mouseenter', () => {
            if (this._tooltipHideTimeout) {
                clearTimeout(this._tooltipHideTimeout);
                this._tooltipHideTimeout = null;
            }
        });
        this.sharedTooltip.addEventListener('mouseleave', () => {
            this._tooltipHideTimeout = setTimeout(() => {
                this._tooltipHideTimeout = null;
                if (this.sharedTooltip) {
                    this.sharedTooltip.style.opacity = '0';
                    this.sharedTooltip.style.pointerEvents = 'none';
                }
            }, 100);
        });
        document.body.appendChild(this.sharedTooltip);
        
        setTimeout(() => {
            this.checkInterval = setInterval(() => this.monitoringChatBoxVstartChange(), 500);
        }, 1000);
    }

    // boxVstart 변화 감지 및 채팅 초기화 처리
    monitoringChatBoxVstartChange() {
        if (this.boxVstart && this.boxVstart.isConnected) return;
        if (this.buttonContainer){
            this.buttonContainer.remove();
            this.buttonContainer = null;
            this.restoreButton = null; 
            this.settingsButton = null;
            this.chatMemo = null;
            this.boxVstart = null;
            this.initialRestoreEndTime = null; // statVBox 재생성 시 초기화
        }

        // ~ 이후에 저장된 채팅입니다. 메시지 찾기
        const boxVstart = document.getElementById('boxVstart');
        if (!boxVstart) return;

        const chatMemo = boxVstart.parentElement;
        if (!chatMemo) return;

        const chatArea = document.getElementById('chatArea');
        if (!chatArea) return;

        const video = document.querySelector('#video');
        if (!video || !video.src || video.readyState < 2) return;

        const tsManager = window.VODSync?.tsManager;
        if (!tsManager) {
            this.warn('SoopTimestampManager를 찾을 수 없습니다.');
            return;
        }

        const currentPlaybackTime = tsManager.getCurPlaybackTime();
        if (currentPlaybackTime === null) {
            this.warn('재생 시간을 가져올 수 없습니다.');
            return;
        }

        // SOOP 공식 패치로 재생 시점 변경 시 최근 30초 채팅은 자동 복원되므로, 그 이전 시점부터 계산
        const endTime = Math.max(0, currentPlaybackTime - this.soopBuiltInRestoreSeconds);
        const startTime = Math.max(0, endTime - this.restoreInterval);
        
        // statVBox 재생성 시점의 실제 재생 시점 저장 (툴팁 "N초 전" 계산 기준, 처음 세팅되는 시점)
        if (this.initialRestoreEndTime === null) {
            this.initialRestoreEndTime = currentPlaybackTime;
        }
        
        this.nextRestorePlan = { 
            startTime, 
            endTime
        };
        
        this.addRestoreButton(chatArea, chatMemo, boxVstart);
        this.log(`채팅 초기화 감지 및 복원 구간 설정: ${this.formatTime(startTime)} ~ ${this.formatTime(endTime)}`);
    }

    // 복원 버튼 추가
    addRestoreButton(chatArea, chatMemo, boxVstart) {
        // 버튼 컨테이너 생성
        const buttonContainer = document.createElement('div');
        buttonContainer.style.cssText = 'display: flex; align-items: center; gap: 5px; margin: 10px; height:35px;';
        buttonContainer.setAttribute('data-vodsync-restore-container', 'true');

        const button = document.createElement('button');
        button.setAttribute('data-vodsync-restore', 'true');
        button.style.cssText = `
            padding: 8px 16px;
            background-color: #4CAF50;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
            font-weight: bold;
            width: 100%;
            height: 35px;
        `;
        button.addEventListener('click', () => this.restorePreviousChats());
        button.addEventListener('mouseenter', () => {
            if (!button.disabled) {
                button.style.backgroundColor = '#45a049';
            }
        });
        button.addEventListener('mouseleave', () => {
            if (!button.disabled) {
                button.style.backgroundColor = '#4CAF50';
            }
        });

        // 설정 버튼 생성
        const settingsBtn = document.createElement('button');
        settingsBtn.setAttribute('data-vodsync-settings', 'true');
        settingsBtn.innerHTML = '⚙️';
        settingsBtn.style.cssText = `
            padding: 8px 12px;
            background-color: #666;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
            max-height: 35px;
        `;
        settingsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.showSettingsPopup();
        });
        settingsBtn.addEventListener('mouseenter', () => settingsBtn.style.backgroundColor = '#555');
        settingsBtn.addEventListener('mouseleave', () => settingsBtn.style.backgroundColor = '#666');

        buttonContainer.appendChild(button);
        buttonContainer.appendChild(settingsBtn);

        // chatArea의 첫 번째 요소 앞에 버튼 컨테이너 추가
        chatArea.insertBefore(buttonContainer, chatArea.firstChild);
        this.buttonContainer = buttonContainer;
        this.restoreButton = button;
        this.settingsButton = settingsBtn;
        this.chatMemo = chatMemo;
        this.boxVstart = boxVstart;
        this.updateButtonText();
        this.tryAutoRestoreOnButtonCreate();
    }

    // 자동 복원이 켜져 있으면 버튼 생성 직후 1회 복원 (재생 시점 변경으로 버튼이 다시 생길 때마다 1회)
    tryAutoRestoreOnButtonCreate() {
        if (!this.autoRestoreEnabled || !this.nextRestorePlan) return;

        const { endTime } = this.nextRestorePlan;
        const startTime = Math.max(0, endTime - this.autoRestorePeriod);
        this.nextRestorePlan = { startTime, endTime };
        this.log(`자동 복원 실행: ${this.formatTime(startTime)} ~ ${this.formatTime(endTime)}`);
        this.restorePreviousChats();
    }

    // 채팅 복원 실행
    async restorePreviousChats() {
        if (this.isRestoring || !this.restoreButton || !this.nextRestorePlan) return;

        this.isRestoring = true;
        this.updateButtonText();

        try {
            const { startTime, endTime } = this.nextRestorePlan;
            const videoId = this.getVideoId();
            if (!videoId) throw new Error('VOD ID를 가져올 수 없습니다.');

            const soopAPI = window.VODSync?.soopAPI;
            if (!soopAPI) throw new Error('SoopAPI를 찾을 수 없습니다.');

            // vodInfo: 이모티콘 매핑, 설정 UI max(chat_duration)
            if (!this.vodInfo) {
                this.vodInfo = await soopAPI.GetSoopVodInfo(videoId);
                this.signatureEmoticon = await soopAPI.GetSignitureEmoticon(this.vodInfo?.data?.bj_id);
                this.defaultEmoticon = await soopAPI.GetEmoticon();
                this.buildEmoticonReplaceMap();
                this.log(`시그니처 이모티콘 로드 완료: ${this.signatureEmoticon}`);
                this.log(`기본 이모티콘 로드 완료: ${this.defaultEmoticon}`);
            }

            const messages = await this.fetchChatData(videoId, startTime, endTime);

            let filteredMessages = messages.filter(msg =>
                msg.timestamp >= startTime * 1000 && msg.timestamp <= endTime * 1000
            );

            let excludedCount = 0;
            if (this.excludeEmoticonOnlyChat) {
                const included = [];
                for (const msg of filteredMessages) {
                    if (this.isEmoticonOnlyMessage(msg)) {
                        excludedCount++;
                    } else {
                        included.push(msg);
                    }
                }
                filteredMessages = included;
            }

            let restoredCount = 0;
            if (filteredMessages.length > 0) {
                const chatElements = filteredMessages.map(msg => this.createChatElement(msg)).filter(el => el !== null);
                restoredCount = chatElements.length;
                this.insertChatsBelowButton(chatElements);
                this.log(`${restoredCount}개 채팅 복원 완료` + (excludedCount > 0 ? ` (${excludedCount}개 제외)` : ''));
            } else {
                this.log('복원할 채팅이 없습니다.');
            }

            // 다음 복원 구간 계산 (더 이전 restoreInterval만큼)
            const nextStart = Math.max(0, startTime - this.restoreInterval);
            const nextEnd = startTime;
            const suffix = excludedCount > 0
                ? ` - ${restoredCount}개, ${excludedCount} 제외`
                : ` - ${restoredCount}개`;
            this._restoreTimeRange = { startTime: nextStart, endTime: nextEnd };
            this.isRestoring = false;
            this.updateButtonText(suffix);

        } catch (error) {
            this.isRestoring = false;
            this.error('채팅 복원 오류:', error);
            if (this.restoreButton) {
                this.updateButtonText(' - 복원 실패, 다시 시도');
            }
        }
    }

    // GetChatLog로 복원 구간 채팅 fetch 후 파싱 (chunk·HTTP 캐시는 SoopAPI)
    async fetchChatData(videoId, startTimeSec, endTimeSec) {
        const soopAPI = window.VODSync?.soopAPI;
        if (!soopAPI) throw new Error('SoopAPI를 찾을 수 없습니다.');
        
        this.log(`채팅 로그 요청: ${startTimeSec}초 ~ ${endTimeSec}초`);
        
        const chatLogXml = await soopAPI.GetChatLog(videoId, startTimeSec, endTimeSec);
        if (!chatLogXml) {
            this.warn('채팅 로그를 가져올 수 없습니다.');
            return [];
        }

        const messages = this.parseChatLogXmlRaw(chatLogXml);
        this.log(`채팅 로그 수신: ${messages.length}개 메시지`);
        return messages;
    }

    // XML 파싱하여 메시지 데이터 반환 (필터링 없이 모든 메시지)
    parseChatLogXmlRaw(xmlText) {
        const messages = [];

        try {
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(xmlText, "application/xml");

            const parserError = xmlDoc.querySelector("parsererror");
            if (parserError) {
                this.error("XML 파싱 오류:", parserError.textContent || parserError.innerText || '');
                return [];
            }

            Array.from(xmlDoc.querySelectorAll("root > chat, root > ogq")).forEach((chat) => {
                const msg = (chat.querySelector('m')?.textContent || '').trim();
                const timestampStr = (chat.querySelector('t')?.textContent || '').trim();
                const isOgq = chat.tagName.toLowerCase() === 'ogq';
                
                let pValue, p2Value;
                if (isOgq) {
                    const sfValue = (chat.querySelector('sf')?.textContent || '').trim();
                    [pValue, p2Value] = sfValue.split('|').map(v => v.trim());
                } else {
                    pValue = (chat.querySelector('p')?.textContent || '').trim();
                    p2Value = (chat.querySelector('p2')?.textContent || '').trim();
                }
                const nicknameColor = (chat.querySelector('nf')?.textContent || '').trim();
                const subscriptionMonths = (chat.querySelector('acfw')?.textContent || '').trim();
                const extValue = (chat.querySelector('ext')?.textContent || '').trim();

                const ogqGid = isOgq ? (chat.querySelector('gid')?.textContent || '').trim() : null;
                const ogqSid = isOgq ? (chat.querySelector('sid')?.textContent || '').trim() : null;
                const ogqVersion = isOgq ? (chat.querySelector('v')?.textContent || '').trim() : null;
                const ogqAnm = isOgq ? (chat.querySelector('anm')?.textContent || '').trim() : null;
                
                const userId = isOgq ? (chat.querySelector('s')?.textContent || '').trim() : (chat.querySelector('u')?.textContent || '').trim();
                const userNick = isOgq ? (chat.querySelector('sn')?.textContent || '').trim() : (chat.querySelector('n')?.textContent || '').trim();
                
                if (!timestampStr) return;

                const timestamp = parseFloat(timestampStr);
                if (isNaN(timestamp) || timestamp === 0) return;

                const timestampMs = Math.floor(timestamp * 1000);

                const p2Num = parseInt(p2Value || '0', 10);
                const subscriptionTier = ((p2Num & 0x80000) !== 0) ? 2 : 1;
                const badgeType = this.getBadgeType(pValue, extValue);
                const gradeValue = this.getGradeValue(pValue, subscriptionMonths);

                let ogqImageUrl = null;
                if (isOgq && ogqGid && ogqSid) {
                    const fileExtension = (ogqAnm === '1') ? 'webp' : 'png';
                    const ogqCdn = this._soopUrls.OGQ_STICKER_CDN_ORIGIN || 'https://ogq-sticker-global-cdn-z01.sooplive.com';
                    ogqImageUrl = `${ogqCdn}/sticker/${ogqGid}/${ogqSid}_80.${fileExtension}?ver=${ogqVersion || '1'}`;
                }

                const ogqPurchaseUrl = isOgq && ogqGid 
                    ? `${this._soopUrls.OGQ_MARKET_ORIGIN || 'https://ogqmarket.sooplive.com'}?m=detail&productId=${ogqGid}`
                    : null;

                messages.push({
                    userId, userNick, msg, timestamp: timestampMs, nicknameColor,
                    subscriptionMonths, subscriptionTier, badgeType, gradeValue,
                    isOgq, ogqImageUrl, ogqPurchaseUrl
                });
            });

            messages.sort((a, b) => a.timestamp - b.timestamp);
            return messages;
        } catch (error) {
            this.error('XML 파싱 오류:', error);
            return [];
        }
    }

    // 채팅 DOM 요소 생성
    createChatElement(chatData) {
        const { 
            userId, 
            userNick, 
            msg, 
            timestamp,
            nicknameColor, 
            subscriptionMonths, 
            subscriptionTier, 
            badgeType, 
            gradeValue,
            isOgq, 
            ogqImageUrl, 
            ogqPurchaseUrl 
        } = chatData;

        if (!userNick && !userId) {
            this.warn('채팅 데이터에 userNick과 userId가 없습니다:', chatData);
            return null;
        }

        const chatItem = document.createElement('div');
        chatItem.className = 'chatting-list-item';
        if (badgeType) {
            chatItem.setAttribute('user-type', badgeType);
        }

        const messageContainer = document.createElement('div');
        messageContainer.className = 'message-container';
        const usernameDiv = document.createElement('div');
        usernameDiv.className = 'username';
        const button = document.createElement('button');
        
        // 퍼스나콘 (구독 개월수 -1이면 표시 안함)
        const subscriptionMonthsNum = parseInt(subscriptionMonths || '-1', 10);
        if (subscriptionMonthsNum !== -1) {
            const thumb = document.createElement('span');
            thumb.className = 'thumb';
            const img = document.createElement('img');
            img.id = 'author';
            if (userId) {
                img.setAttribute('user_id', userId);
                img.setAttribute('user_nick', userNick || '');
                img.setAttribute('grade', gradeValue.toString());
                const personalconUrl = this.getPersonalconUrl(subscriptionMonths, subscriptionTier || 1);
                img.src = personalconUrl || `${this._soopUrls.RES_ORIGIN || 'https://res.sooplive.com'}/images/chatting/signature-default.svg`;
            } else {
                img.setAttribute('user_nick', userNick || '');
                img.setAttribute('grade', gradeValue.toString());
                img.src = `${this._soopUrls.RES_ORIGIN || 'https://res.sooplive.com'}/images/chatting/signature-default.svg`;
            }
            img.onerror = function() {
                this.src = `${window.VODSync?.SoopUrls?.RES_ORIGIN || 'https://res.sooplive.com'}/images/chatting/signature-default.svg`;
            };
            thumb.appendChild(img);
            button.appendChild(thumb);
        }
        
        // 배지
        if (badgeType) {
            const badge = document.createElement('span');
            if (badgeType === 'support') {
                badge.className = 'grade-badge-support';
                badge.setAttribute('tip', '서포터');
                badge.innerText = 'S';
            } else if (badgeType === 'vip') {
                badge.className = 'grade-badge-vip';
                badge.setAttribute('tip', '열혈팬');
                badge.innerText = '열';
            } else if (badgeType === 'vip-monthly') {
                badge.className = 'grade-badge-vip-monthly';
                badge.setAttribute('tip', '월간 열혈팬');
                badge.innerText = '열';
            } else if (badgeType === 'vip-both') {
                badge.className = 'grade-badge-vip-both';
                badge.setAttribute('tip', '누적 · 월간 열혈팬');
                badge.innerText = '열';
            } else if (badgeType === 'subscribe') {
                badge.className = 'grade-badge-fan';
                badge.setAttribute('tip', '팬클럽');
                badge.innerText = 'F';
            } else if (badgeType === 'manager') {
                badge.className = 'grade-badge-manager';
                badge.setAttribute('tip', '매니저');
                badge.innerText = 'M';
            }
            badge.id = 'author';
            if (userId) badge.setAttribute('user_id', userId);
            badge.setAttribute('user_nick', userNick || '');
            badge.setAttribute('grade', gradeValue.toString());
            button.appendChild(badge);
        }
        
        // 사용자명
        const author = document.createElement('span');
        author.className = 'author random-color4';
        author.id = 'author';
        author.setAttribute('href', 'javascript:;');
        if (userId) author.setAttribute('user_id', userId);
        author.setAttribute('user_nick', userNick || '');
        author.setAttribute('grade', gradeValue.toString());
        author.innerText = userNick || '알 수 없음';
        if (nicknameColor) {
            author.style.color = `#${nicknameColor}`;
        }
        button.appendChild(author);
        usernameDiv.appendChild(button);

        // 메시지 텍스트
        const messageTextDiv = document.createElement('div');
        messageTextDiv.className = 'message-text';
        
        // OGQ 이모티콘
        if (isOgq && ogqImageUrl && ogqPurchaseUrl) {
            const emoticonBox = document.createElement('div');
            emoticonBox.className = 'emoticon-box';
            const imgBox = document.createElement('a');
            imgBox.className = 'img-box';
            imgBox.setAttribute('tip', '구매하기');
            imgBox.href = ogqPurchaseUrl;
            imgBox.target = '_blank';
            const ogqImg = document.createElement('img');
            ogqImg.className = 'ogqEmoticon';
            ogqImg.setAttribute('data-original-ext', ogqImageUrl.includes('.webp') ? 'webp' : 'png');
            ogqImg.style.cursor = 'pointer';
            ogqImg.src = ogqImageUrl;
            ogqImg.onerror = function() {
                this.src = `${window.VODSync?.SoopUrls?.RES_ORIGIN || 'https://res.sooplive.com'}/images/chat/ogq_default.png`;
            };
            imgBox.appendChild(ogqImg);
            emoticonBox.appendChild(imgBox);
            messageTextDiv.appendChild(emoticonBox);
        }
        
        const p = document.createElement('p');
        p.className = 'msg';
        p.style.color = '0';
        
        // 시그니처 이모티콘 처리
        if (msg && this.signatureEmoticon) {
            this.processSignatureEmoticons(p, msg);
        } else {
            p.innerText = msg || '';
        }
        
        // playbackTime 커스텀 툴팁 및 클릭 시 해당 시점으로 이동
        const playbackTimeSeconds = timestamp ? Math.floor(timestamp / 1000) : 0;
        if (timestamp && this.initialRestoreEndTime !== null && this.sharedTooltip) {
            const secondsAgo = Math.floor(this.initialRestoreEndTime - playbackTimeSeconds);

            let tooltipText;
            if (secondsAgo < 0) {
                tooltipText = this.formatTime(playbackTimeSeconds);
            } else if (secondsAgo === 0) {
                tooltipText = '방금 전';
            } else {
                const hours = Math.floor(secondsAgo / 3600);
                const minutes = Math.floor((secondsAgo % 3600) / 60);
                const seconds = secondsAgo % 60;
                const parts = [];
                if (hours > 0) parts.push(`${hours}시간`);
                if (minutes > 0) parts.push(`${minutes}분`);
                if (seconds > 0 || parts.length === 0) parts.push(`${seconds}초`);
                tooltipText = `${parts.join(' ')} 전`;
            }
            messageTextDiv.addEventListener('mouseenter', (e) => {
                if (!this.sharedTooltip) return;
                if (this._tooltipHideTimeout) {
                    clearTimeout(this._tooltipHideTimeout);
                    this._tooltipHideTimeout = null;
                }
                const rect = messageTextDiv.getBoundingClientRect();
                this.sharedTooltip.dataset.playbackTimeSeconds = String(playbackTimeSeconds);
                this.sharedTooltip.textContent = tooltipText;
                this.sharedTooltip.style.right = `${window.innerWidth - rect.right}px`;
                this.sharedTooltip.style.top = `${rect.top - 5}px`;
                this.sharedTooltip.style.opacity = '1';
                this.sharedTooltip.style.pointerEvents = 'auto';
                this.sharedTooltip.style.cursor = 'pointer';
            });
            messageTextDiv.addEventListener('mouseleave', (e) => {
                if (!this.sharedTooltip) return;
                if (e.relatedTarget === this.sharedTooltip) return;
                this._tooltipHideTimeout = setTimeout(() => {
                    this._tooltipHideTimeout = null;
                    if (this.sharedTooltip) {
                        this.sharedTooltip.style.opacity = '0';
                        this.sharedTooltip.style.pointerEvents = 'none';
                    }
                }, 100);
            });
        }

        messageTextDiv.appendChild(p);

        messageContainer.appendChild(usernameDiv);
        messageContainer.appendChild(messageTextDiv);
        chatItem.appendChild(messageContainer);

        return chatItem;
    }

    // 채팅을 버튼 컨테이너와 다음 요소 사이에 삽입
    insertChatsBelowButton(chatElements) {
        if (!this.chatMemo || chatElements.length === 0) return;

        const fragment = document.createDocumentFragment();
        chatElements.forEach(el => fragment.appendChild(el));

        // chatMemo의 첫 번째 요소 앞에 삽입
        if (this.chatMemo.firstChild) {
            this.chatMemo.insertBefore(fragment, this.chatMemo.firstChild);
        } else {
            this.chatMemo.appendChild(fragment);
        }
    }

    // 기본 버튼 문구 (nextRestorePlan + suffix 기준, 복원 중이면 복원 중 문구)
    generateRestoreButtonText(suffix = '') {
        if (this.isRestoring) return `이전 채팅 복원 (${this.restoreInterval}초) - 복원 중...`;
        if (!this.nextRestorePlan) return '이전 채팅 복원 준비 중';
        const { startTime, endTime } = this.nextRestorePlan;
        if (startTime === 0 && endTime === 0) return '영상의 시작 지점에 도달함';
        return `이전 채팅 복원 (${this.restoreInterval}초)${suffix}`;
    }

    // 버튼 텍스트 및 상태 업데이트 (nextRestorePlan / isRestoring 기준, suffix는 매개변수로 받음)
    updateButtonText(suffix = '') {
        if (!this.restoreButton) return;

        const atStart = this.nextRestorePlan && this.nextRestorePlan.startTime === 0 && this.nextRestorePlan.endTime === 0;
        const disabled = this.isRestoring || atStart;

        this.restoreButton.disabled = disabled;
        if (disabled) {
            this.restoreButton.style.backgroundColor = '#cccccc';
            this.restoreButton.style.color = '#333333';
            this.restoreButton.style.cursor = 'not-allowed';
            this.restoreButton.style.opacity = '0.6';
        } else {
            this.restoreButton.style.backgroundColor = '#4CAF50';
            this.restoreButton.style.color = 'white';
            this.restoreButton.style.cursor = 'pointer';
            this.restoreButton.style.opacity = '1';
        }

        this.restoreButton.innerText = this.generateRestoreButtonText(suffix);

        if (!this.nextRestorePlan) {
            this.restoreButton.title = '';
            return;
        }
        const { startTime, endTime } = this.nextRestorePlan;
        if (startTime !== undefined && endTime !== undefined) {
            if (startTime === 0 && endTime === 0) {
                this.restoreButton.title = '영상의 시작 지점에 도달함';
            } else {
                this.restoreButton.title = `다음 복원 구간: ${this.formatTime(startTime)} ~ ${this.formatTime(endTime)}`;
            }
        } else {
            this.restoreButton.title = '';
        }
    }

    // 초를 HH:MM:SS 형식으로 변환
    formatTime(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }

    // 시그니처 이모티콘 및 기본 이모티콘 매핑 데이터 생성
    buildEmoticonReplaceMap() {
        this.emoticonReplaceMap.clear();
        
        // 시그니처 이모티콘 처리
        if (this.signatureEmoticon?.data && this.signatureEmoticon?.img_path) {
            const imgPath = this.signatureEmoticon.img_path;
            const tier1 = this.signatureEmoticon.data.tier1 || [];
            const tier2 = this.signatureEmoticon.data.tier2 || [];
            const allEmoticons = [...tier1, ...tier2];

            allEmoticons.forEach(emoticon => {
                // move_img가 'Y'이면 pc_alternate_img 사용, 아니면 pc_img 사용
                const imgFileName = emoticon.move_img === 'Y' && emoticon.pc_alternate_img 
                    ? emoticon.pc_alternate_img 
                    : emoticon.pc_img;
                const imgUrl = imgPath + imgFileName;
                const imgHtml = `<img class="emoticon" src="${imgUrl}">`;
                
                // `/이모티콘ID/` -> `<img>` HTML 매핑
                this.emoticonReplaceMap.set(`/${emoticon.title}/`, imgHtml);
            });
        }

        // 기본 이모티콘 처리
        if (this.defaultEmoticon?.data) {
            // default 그룹 처리
            if (this.defaultEmoticon.data.default?.groups) {
                const defaultGroups = this.defaultEmoticon.data.default.groups;
                const defaultUrl = this.defaultEmoticon.data.default.small_url || this.defaultEmoticon.data.default.big_url;
                
                defaultGroups.forEach(group => {
                    if (group.emoticons) {
                        group.emoticons.forEach(emoticon => {
                            if (!emoticon.isDeprecated && emoticon.keyword && emoticon.fileName) {
                                const imgUrl = defaultUrl + emoticon.fileName;
                                const imgHtml = `<img class="emoticon" src="${imgUrl}">`;
                                this.emoticonReplaceMap.set(emoticon.keyword, imgHtml);
                            }
                        });
                    }
                });
            }

            // subscribe 그룹 처리
            if (this.defaultEmoticon.data.subscribe?.groups) {
                const subscribeGroups = this.defaultEmoticon.data.subscribe.groups;
                const subscribeUrl = this.defaultEmoticon.data.subscribe.small_url || this.defaultEmoticon.data.subscribe.big_url;
                
                subscribeGroups.forEach(group => {
                    if (group.emoticons) {
                        group.emoticons.forEach(emoticon => {
                            if (!emoticon.isDeprecated && emoticon.keyword && emoticon.fileName) {
                                // staticFileName이 있으면 사용, 없으면 fileName 사용
                                const imgFileName = emoticon.staticFileName || emoticon.fileName;
                                const imgUrl = subscribeUrl + imgFileName;
                                const imgHtml = `<img class="emoticon" src="${imgUrl}">`;
                                this.emoticonReplaceMap.set(emoticon.keyword, imgHtml);
                            }
                        });
                    }
                });
            }
        }
    }

    // 이모티콘만으로 이루어진 메시지 여부 (복원 제외 대상 판별용)
    isEmoticonOnlyMessage(chatData) {
        const { msg, isOgq } = chatData;
        // OGQ만 있고 텍스트가 없으면 이모티콘만
        if (isOgq && (!msg || !String(msg).trim())) {
            return true;
        }
        const text = (msg || '').trim();
        if (!text) return false;
        let rest = text;
        this.emoticonReplaceMap.forEach((_, pattern) => {
            rest = rest.split(pattern).join('');
        });
        return rest.trim() === '';
    }

    // 메시지 텍스트에서 시그니처 이모티콘 처리
    processSignatureEmoticons(pElement, msgText) {
        if (this.emoticonReplaceMap.size === 0) {
            pElement.innerText = msgText;
            return;
        }

        let processedText = msgText;
        
        // 매핑 데이터를 사용하여 모든 이모티콘 교체
        this.emoticonReplaceMap.forEach((imgHtml, emoticonPattern) => {
            processedText = processedText.replaceAll(emoticonPattern, imgHtml);
        });

        // HTML로 설정
        pElement.innerHTML = processedText;
    }

    // VOD ID 가져오기
    getVideoId() {
        const match = window.location.pathname.match(/\/player\/(\d+)/);
        return match ? match[1] : null;
    }

    // 구독 개월수에 맞는 퍼스나콘 이미지 URL 가져오기
    getPersonalconUrl(subscriptionMonths, subscriptionTier = 1) {
        if (!this.vodInfo?.data?.subscription_personalcon) {
            return null;
        }

        const monthsNum = parseInt(subscriptionMonths || '0', 10);
        if (isNaN(monthsNum) || monthsNum < 0) return null;

        const tier = subscriptionTier === 2 
            ? this.vodInfo.data.subscription_personalcon.tier2 
            : this.vodInfo.data.subscription_personalcon.tier1;
        
        if (!tier || tier.length === 0) return null;

        // monthsNum 이하인 것 중 가장 큰 값
        let bestMatch = null;
        for (const item of tier) {
            if (item.month <= monthsNum) {
                if (!bestMatch || item.month > bestMatch.month) {
                    bestMatch = item;
                }
            }
        }

        return bestMatch?.file_name || tier[0]?.file_name || null;
    }

    // p 태그 값(누적열혈팬) + ext 태그 값(tfm=11이면 월간열혈팬)에 따른 배지 타입 결정
    getBadgeType(pValue, extValue) {
        const pNum = parseInt(pValue || '0', 10);
        const isCumulativeHotFan = (pNum & 0x8000) !== 0;
        const isMonthlyHotFan = /(?:^|&)tfm=11(?:&|$)/.test(extValue || '');

        if ((pNum & 0x40) !== 0) return 'manager';
        if (isCumulativeHotFan && isMonthlyHotFan) return 'vip-both';
        if (isCumulativeHotFan) return 'vip';
        if (isMonthlyHotFan) return 'vip-monthly';
        if ((pNum & 0x20) !== 0) return 'subscribe';
        if ((pNum & 0x100000) !== 0) return 'support';
        return null;
    }

    // grade 속성 값 계산 (3: 팬클럽 이상, 6: 구독자, 5: 둘 다 아님)
    getGradeValue(pValue, subscriptionMonths) {
        const pNum = parseInt(pValue || '0', 10);
        const monthsNum = parseInt(subscriptionMonths || '-1', 10);
        
        const isFanClubOrVip = (pNum & 0x20) !== 0;
        const isSubscriber = monthsNum !== -1;
        
        if (isSubscriber) return 6;
        if (isFanClubOrVip) return 3;
        return 5;
    }

    // 설정 팝업 표시
    showSettingsPopup() {
        // 기존 팝업이 있으면 제거
        if (this.settingsPopup && this.settingsPopup.parentElement) {
            this.settingsPopup.remove();
        }

        if (!this.settingsButton) return;

        const maxDuration = this.vodInfo?.data?.chat_duration;

        // 설정 버튼의 위치 정보 가져오기
        const buttonRect = this.settingsButton.getBoundingClientRect();
        const popupWidth = 300; // min-width와 동일

        const popup = document.createElement('div');
        popup.style.cssText = `
            position: fixed;
            top: ${buttonRect.bottom}px;
            right: ${window.innerWidth - buttonRect.right}px;
            background: white;
            border: 2px solid #4CAF50;
            border-radius: 8px;
            padding: 20px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.3);
            z-index: 10000;
            min-width: ${popupWidth}px;
        `;

        const title = document.createElement('div');
        title.innerText = '복원 구간 설정';
        title.style.cssText = 'font-size: 18px; font-weight: bold; margin-bottom: 15px;';

        const label = document.createElement('div');
        label.innerText = `복원 구간: ${this.restoreInterval}초`;
        label.id = 'vodsync-interval-label';
        label.style.cssText = 'margin-bottom: 10px; font-size: 14px;';

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = '10';
        slider.max = String(maxDuration || 300);
        slider.step = '10';
        slider.value = String(this.restoreInterval);
        slider.style.cssText = 'width: 100%; margin-bottom: 15px;';

        slider.addEventListener('input', (e) => {
            const value = parseInt(e.target.value, 10);
            label.innerText = `복원 구간: ${value}초`;
        });

        const excludeEmoticonOnlyLabel = document.createElement('label');
        excludeEmoticonOnlyLabel.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-bottom: 15px; font-size: 14px; cursor: pointer;';
        const excludeEmoticonOnlyCheck = document.createElement('input');
        excludeEmoticonOnlyCheck.type = 'checkbox';
        excludeEmoticonOnlyCheck.checked = this.excludeEmoticonOnlyChat;
        excludeEmoticonOnlyLabel.appendChild(excludeEmoticonOnlyCheck);
        excludeEmoticonOnlyLabel.appendChild(document.createTextNode('이모티콘만으로 이루어진 채팅 복원 제외'));

        const autoRestoreLabel = document.createElement('label');
        autoRestoreLabel.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-bottom: 10px; font-size: 14px; cursor: pointer;';
        const autoRestoreCheck = document.createElement('input');
        autoRestoreCheck.type = 'checkbox';
        autoRestoreCheck.checked = this.autoRestoreEnabled;
        autoRestoreLabel.appendChild(autoRestoreCheck);
        autoRestoreLabel.appendChild(document.createTextNode('버튼 생성 시 자동 복원 (1회)'));

        const autoRestorePeriodLabel = document.createElement('div');
        autoRestorePeriodLabel.innerText = `자동 복원 구간: ${this.autoRestorePeriod}초`;
        autoRestorePeriodLabel.id = 'vodsync-auto-restore-period-label';
        autoRestorePeriodLabel.style.cssText = 'margin-bottom: 10px; font-size: 14px;';

        const autoRestorePeriodSlider = document.createElement('input');
        autoRestorePeriodSlider.type = 'range';
        autoRestorePeriodSlider.min = '10';
        autoRestorePeriodSlider.max = String(maxDuration || 300);
        autoRestorePeriodSlider.step = '10';
        autoRestorePeriodSlider.value = String(this.autoRestorePeriod);
        autoRestorePeriodSlider.style.cssText = 'width: 100%; margin-bottom: 15px;';
        autoRestorePeriodSlider.disabled = !this.autoRestoreEnabled;

        const syncAutoRestorePeriodControls = (enabled) => {
            autoRestorePeriodSlider.disabled = !enabled;
            autoRestorePeriodLabel.style.opacity = enabled ? '1' : '0.5';
        };
        autoRestoreCheck.addEventListener('change', () => {
            syncAutoRestorePeriodControls(autoRestoreCheck.checked);
        });
        autoRestorePeriodSlider.addEventListener('input', (e) => {
            const value = parseInt(e.target.value, 10);
            autoRestorePeriodLabel.innerText = `자동 복원 구간: ${value}초`;
        });

        const buttonContainer = document.createElement('div');
        buttonContainer.style.cssText = 'display: flex; gap: 10px; justify-content: flex-end;';

        const cancelBtn = document.createElement('button');
        cancelBtn.innerText = '취소';
        cancelBtn.style.cssText = `
            padding: 8px 16px;
            background-color: #ccc;
            color: black;
            border: none;
            border-radius: 4px;
            cursor: pointer;
        `;
        cancelBtn.addEventListener('click', () => {
            popup.remove();
        });

        const saveBtn = document.createElement('button');
        saveBtn.innerText = '저장';
        saveBtn.style.cssText = `
            padding: 8px 16px;
            background-color: #4CAF50;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
        `;
        saveBtn.addEventListener('click', async () => {
            const newInterval = parseInt(slider.value, 10);
            this.restoreInterval = newInterval;
            this.excludeEmoticonOnlyChat = excludeEmoticonOnlyCheck.checked;
            this.autoRestoreEnabled = autoRestoreCheck.checked;
            this.autoRestorePeriod = parseInt(autoRestorePeriodSlider.value, 10);
            this.log(`복원 구간 단위 변경: ${newInterval}초, 이모티콘만 제외: ${this.excludeEmoticonOnlyChat}, 자동 복원: ${this.autoRestoreEnabled} (${this.autoRestorePeriod}초)`);

            // 설정 저장
            await this.saveRestoreInterval();
            
            // 현재 restoreTimeRange가 있으면 새로운 interval로 재계산
            if (this.nextRestorePlan) {
                const { endTime } = this.nextRestorePlan;
                const nextStart = Math.max(0, endTime - this.restoreInterval);
                this.nextRestorePlan = { startTime: nextStart, endTime: endTime };
            }

            popup.remove();
        });

        buttonContainer.appendChild(cancelBtn);
        buttonContainer.appendChild(saveBtn);

        popup.appendChild(title);
        popup.appendChild(label);
        popup.appendChild(slider);
        popup.appendChild(excludeEmoticonOnlyLabel);
        popup.appendChild(autoRestoreLabel);
        popup.appendChild(autoRestorePeriodLabel);
        popup.appendChild(autoRestorePeriodSlider);
        popup.appendChild(buttonContainer);

        document.body.appendChild(popup);
        this.settingsPopup = popup;
    }
}

import { TimestampManagerBase } from './base_timestamp_manager.js';

const MAX_DURATION_DIFF = 30*1000;
export class SoopTimestampManager extends TimestampManagerBase {
    constructor() {
        super();
        this.vodInfo = null;
        this.playTimeTag = null;
        this.isEditedVod = false; // 다시보기의 일부분이 편집된 상태인가
        
        this.timeLink = null;
        /** @type {ReturnType<typeof setInterval>|null} ghost 없을 때 time_link 폴백용 */
        this._timeLinkJumpIntervalId = null;
        this.debug('loaded');

        this.reloadingAll = false; // 현재 VOD 정보와 태그를 업데이트 중인가
        this.loop_playing = false;
    }

    /**
     * vodCore 페이지 브리지 ghost (`#__vs_vodcore_ghost`). 브리지 미주입 시 null.
     * @returns {HTMLElement|null}
     */
    _getVodCoreGhost() {
        return window.VODSync?.vodCoreBridge?.getGhost?.() ?? null;
    }

    update(){
        super.update();
        this.simpleLoopSettingUpdate();

        // VOD 변경 감지
        const url = new URL(window.location.href);
        const match = url.pathname.match(/\/player\/(\d+)/);
        if (!match || match.length < 2)
        {
            this.warn('VOD ID를 가져오지 못했습니다. URL 파싱 실패 (' + url.pathname + ')');
            return;
        }
        const curVideoId = match[1];
        if (this.vodInfo === null || curVideoId !== this.vodInfo.id){
            this.log('VOD 변경 감지됨! 요소 업데이트 중...');
            this.reloadAll(curVideoId);
        }
    }
    
    moveTooltipToCtrlBox(){
        const ctrlBox = document.querySelector('.ctrlBox');
        const rightCtrl = document.querySelector('.right_ctrl');
        if (ctrlBox && rightCtrl && this.tooltipContainer) { 
            ctrlBox.insertBefore(this.tooltipContainer, rightCtrl);
            this.tooltipContainer.style.position = '';
            this.tooltipContainer.style.bottom = '';
            this.tooltipContainer.style.right = '';
            return true;
        }
        return false;
    }

    simpleLoopSettingUpdate(){
        const LABEL_TEXT = '반복 재생';
        const EM_TEXT_IDLE = '(added by VOD Master)';

        // 반복재생 설정이 켜져있고 비디오 태그를 찾은 경우
        if (this.videoTag !== null && this.loop_playing){
            // 현재 재생 시간이 영상 전체 재생 시간과 같은 경우 처음으로 이동
            if (this.getCurPlaybackTime() === Math.floor(this.vodInfo.total_file_duration / 1000)){
                this.moveToPlaybackTime(0);
                // 비디오 태그가 일시정지 상태인 경우 재생
                if (this.videoTag.paused){
                    this.videoTag.play();
                }
            }
        }

        //반복 재생 설정 메뉴 추가 로직
        const settingList = document.querySelector('.setting_list');
        if (!settingList) return; // 설정 창을 열지 않음.
        if (settingList.classList.contains('subLayer_on')) return; // 서브 레이어가 열려있으면 추가하지 않음.
        const ul = settingList.childNodes[0];
        const _exists = ul.querySelector('#VODSync');
        if (_exists) return; // 이미 추가되어 있음.
        
        const li = document.createElement('li');
        li.className = 'switchBtn_wrap loop_playing';
        li.id = 'VODSync';
        const label = document.createElement('label');
        label.for = 'loop_playing';
        label.innerText = LABEL_TEXT;
        const em = document.createElement('em');
        em.innerText = EM_TEXT_IDLE;
        em.style.color = '#c7cad1';
        // em.style.fontSize = '12px';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.id = 'loop_playing';
        input.checked = this.loop_playing;
        input.addEventListener('change',()=> {
            const a = document.querySelector('#VODSync input');
            this.loop_playing = a.checked;
            if (this.loop_playing){
                const autoPlayInput = document.querySelector('#autoplayChk');
                if (autoPlayInput && autoPlayInput.checked){
                    autoPlayInput.click();
                }
            }
            this.debug('loop_playing: ', this.loop_playing);
        });
        const span = document.createElement('span');
        label.appendChild(em);
        label.appendChild(input);
        label.appendChild(span);
        li.appendChild(label);
        ul.appendChild(li);
        
    }

    async loadVodInfo(videoId){
        const vodInfo = await window.VODSync.soopAPI.GetSoopVodInfo(videoId);
        if (!vodInfo || !vodInfo.data || vodInfo.result !== 1) return;
        this.vodInfo = {
            id: videoId,
            type: vodInfo.data.file_type,
            files: vodInfo.data.files,
            total_file_duration: vodInfo.data.total_file_duration,
            originVodInfo: null, // 원본 다시보기의 정보
            view_cnt: vodInfo.data.view_cnt,
            live_total_view: vodInfo.data.live_total_view,
        }
        if (vodInfo.data.write_tm){
            const splitres = vodInfo.data.write_tm.split(' ~ ');
            this.vodInfo.startDate = new Date(splitres[0]);
            this.vodInfo.endDate = splitres[1] ? new Date(splitres[1]) : null;
        }
        // 클립은 라이브나 다시보기에서 생성될 수 있고 캐치는 클립에서도 생성될 수 있음.
        // 현재 페이지가 클립이거나 캐치인 경우 원본 VOD의 정보를 읽음
        if (this.vodInfo.type === 'NORMAL'){
            return;
        }
        else if (this.vodInfo.type === 'CLIP' || this.vodInfo.type === 'CATCH'){
            if (vodInfo.data.original_clip_scheme){
                const searchParamsStr = vodInfo.data.original_clip_scheme.split('?')[1];
                const params = new URLSearchParams(searchParamsStr);
                const originVodType = params.get('type');
                const originVodId = params.get('title_no');
                const originVodChangeSecond = parseInt(params.get('changeSecond'));
                const originVodInfo = await window.VODSync.soopAPI.GetSoopVodInfo(originVodId);
                if (originVodInfo && originVodInfo.data){
                    const splitres = originVodInfo.data.write_tm.split(' ~ ');
                    // 원본 VOD가 다시보기인 경우 원본 VOD의 정보를 읽음
                    if (originVodType === 'REVIEW'){
                        this.vodInfo.originVodInfo = {
                            type: originVodInfo.data.file_type,
                            startDate: new Date(splitres[0]),
                            endDate: new Date(splitres[1]),
                            files: originVodInfo.data.files,
                            total_file_duration: originVodInfo.data.total_file_duration,
                            originVodChangeSecond: originVodChangeSecond, // 원본 다시보기에서 현재 vod의 시작 시점의 시작 시간
                        }
                        this.vodInfo.startDate = new Date(this.vodInfo.originVodInfo.startDate.getTime() + originVodChangeSecond * 1000);
                        this.vodInfo.endDate = new Date(this.vodInfo.startDate.getTime() + this.vodInfo.total_file_duration);
                    }
                    // 원본 VOD가 클립인 경우 클립의 원본 VOD(다시보기) 정보를 읽음
                    else if (originVodType === 'CLIP'){
                        if (originVodInfo.data.original_clip_scheme){
                            const searchParamsStr = originVodInfo.data.original_clip_scheme.split('?')[1];
                            const params = new URLSearchParams(searchParamsStr);
                            const originOriginVodType = params.get('type');
                            if (originOriginVodType === 'REVIEW'){
                                const originOriginVodId = params.get('title_no');
                                const originOriginVodChangeSecond = parseInt(params.get('changeSecond'));
                                const originOriginVodInfo = await window.VODSync.soopAPI.GetSoopVodInfo(originOriginVodId);
                                if (originOriginVodInfo && originOriginVodInfo.data){
                                    const splitres = originOriginVodInfo.data.write_tm.split(' ~ ');
                                    this.vodInfo.originVodInfo = {
                                        type: originOriginVodInfo.data.file_type,
                                        startDate: new Date(splitres[0]),
                                        endDate: new Date(splitres[1]),
                                        files: originOriginVodInfo.data.files,
                                        total_file_duration: originOriginVodInfo.data.total_file_duration,
                                        originVodChangeSecond: originVodChangeSecond + originOriginVodChangeSecond, // 원본 다시보기에서 현재 vod의 시작 시점의 시작 시간
                                    };
                                    this.vodInfo.startDate = new Date(this.vodInfo.originVodInfo.startDate.getTime() + (originVodChangeSecond+originOriginVodChangeSecond) * 1000);
                                    this.vodInfo.endDate = new Date(this.vodInfo.startDate.getTime() + this.vodInfo.total_file_duration);
                                }
                            }
                            else{
                                this.warn(`${this.videoId}를 제보해주시기 바랍니다.\n[VOD Master 설정] > [문의하기]`);
                            }
                        }
                    }
                }
            }
            else{
                this.vodInfo.startDate = null;
                this.vodInfo.endDate = null;
                this.log('원본 다시보기와 연결되어 있지 않은 VOD입니다.');
                return;
            }
        }
        else if (this.vodInfo.type === 'EDITOR'){
            this.vodInfo.startDate = null;
            this.vodInfo.endDate = null;
            this.log('편집된 VOD입니다.');
            return;
        }
        const calcedTotalDuration = this.vodInfo.endDate.getTime() - this.vodInfo.startDate.getTime();
        const durationDiff = Math.abs(calcedTotalDuration - this.vodInfo.total_file_duration);
        this.debug('오차: ', durationDiff);
        if (durationDiff < MAX_DURATION_DIFF){
            this.isEditedVod = false;
        }
        else{
            this.isEditedVod = true;
            this.log('영상 전체 재생 시간과 계산된 재생 시간이 다릅니다.');
        }
        this.log('영상 정보 로드 완료');
    }

    
    async reloadAll(videoId){
        if (this.reloadingAll) return;
        this.reloadingAll = true;
        try {
            const time = this.vodInfo == null ? 0 : 1000;
            await new Promise(r => setTimeout(r, time));
            await this.loadVodInfo(videoId);
            this.reloadVideoTag();
            this.moveTooltipToCtrlBox();
        } finally {
            this.reloadingAll = false;
        }
    }
    reloadVideoTag(){
        this.playTimeTag = document.querySelector('span.time-current');
        this.videoTag = document.querySelector('#video');
        
        if (this.vodInfo && this.vodInfo.type === "REVIEW"){ // 다시보기인 경우 순수 조회수 표시
            const vodViewCountTags = document.querySelectorAll('div.cnt_info li:nth-child(1) strong');
            // vod player가 스크린모드이거나 전체화면인 경우 영상 위 오버레이에도 조회수가 표시되는데 스크린모드상태에서 새로고침하면 스크린모드가 켜진 상태로 페이지가 로드되어 selector에 첫번째로 잡힌 오버레이에 잘못 설정되어 video밖의 조회수 표시에 적용되지 않는 문제가 존재하여 querySelectorAll로 개수를 체크하여 다르게 처리.
            const vodViewCountTag = vodViewCountTags.length === 2 ? vodViewCountTags[1] : vodViewCountTags[0];
            const realViewCount = this.vodInfo.view_cnt - this.vodInfo.live_total_view ;
            if (vodViewCountTag){
                if (realViewCount != NaN)
                    vodViewCountTag.setAttribute('tip', `순 조회수 ${realViewCount}회`);
                else
                    vodViewCountTag.setAttribute('tip', `순 조회수 불러오기 실패`);
            }
        }
        if (this.videoTag === null)
            this.videoTag = document.querySelector('#video_p');
        
        if (this.playTimeTag === null)
            setTimeout(()=>{this.reloadVideoTag()}, 500);
        else if (this.videoTag === null){
            this.log('playTimeTag 갱신됨', this.playTimeTag);
            setTimeout(()=>{this.reloadVideoTag()}, 500);
        }
        else{
            this.log('videoTag 갱신됨', this.videoTag);
        }
    }
    /* override methods */
    observeDOMChanges() {
        // const targetNode = document.body;
        // const config = { childList: true, subtree: true };

        // this.observer = new MutationObserver(() => {
        //     this.reloadAll();
        // });

        // this.observer.observe(targetNode, config);
    }
    getStreamPeriod(){
        if (!this.vodInfo || this.vodInfo.type === 'NORMAL') return null;
        const startDate = this.vodInfo.originVodInfo === null ? this.vodInfo.startDate : this.vodInfo.originVodInfo.startDate;
        const endDate = this.vodInfo.originVodInfo === null ? this.vodInfo.endDate : this.vodInfo.originVodInfo.endDate;
        return [startDate, endDate];
    }
    playbackTimeToGlobalTS(totalPlaybackSec){
        if (!this.vodInfo) return null;

        // 최대한 다시보기의 정보를 참고해야한다. 다시보기의 일부분이 잘렸을 수 있기 때문에
        let reviewDataFiles = null;
        let deltaTimeSec = 0;
        if (this.vodInfo.type === 'REVIEW'){
            reviewDataFiles = this.vodInfo.files;
        }
        else if (this.vodInfo.originVodInfo !== null && this.vodInfo.originVodInfo.files.length > 0)
        {
            reviewDataFiles = this.vodInfo.originVodInfo.files;
            deltaTimeSec = this.vodInfo.originVodInfo.originVodChangeSecond;
        }
        else{ // 다시보기(originVodInfo) 정보가 없거나 파일이 없는 경우 (원본 영상이 구플이라서 접근이 안되는 경우 등)
            return new Date(this.vodInfo.startDate.getTime() + totalPlaybackSec * 1000);
        }

        if (this.isEditedVod && reviewDataFiles.length > 1 && this.vodInfo.type !== 'REVIEW'){
            this.warn(`${this.videoId}를 제보해주시기 바랍니다.\n[VOD Master 설정] > [문의하기]`);
            return null;
        }
        
        let cumulativeTime = 0
        for (let i = 0; i < reviewDataFiles.length; ++i){
            const file = reviewDataFiles[i];
            const localPlaybackTime = totalPlaybackSec*1000 + deltaTimeSec*1000- cumulativeTime;
            // const hour = Math.floor(localPlaybackTime / 3600000);
            // const minute = Math.floor((localPlaybackTime % 3600000) / 60000);
            // const second = Math.floor((localPlaybackTime % 60000) / 1000);
            // this.log(`localPlaybackTime: ${hour}:${minute}:${second}`);    
            if (localPlaybackTime > file.duration){
                cumulativeTime += file.duration;
                continue;
            }
            const startTime = new Date(file.file_start);
            return new Date(startTime.getTime() + localPlaybackTime);
        }
        return null;
    }
    /// globalTS: milliseconds
    globalTSToPlaybackTime(globalTS){
        if (!this.vodInfo || !this.videoTag) return null;       

        // 최대한 다시보기의 정보를 참고해야한다. 다시보기의 일부분이 잘렸을 수 있기 때문에
        let reviewDataFiles = null;
        let deltaTimeSec = 0;
        if (this.vodInfo.type === 'REVIEW'){
            reviewDataFiles = this.vodInfo.files;
        }
        else if (this.vodInfo.originVodInfo !== null && this.vodInfo.originVodInfo.files.length > 0)
        {
            reviewDataFiles = this.vodInfo.originVodInfo.files;
            deltaTimeSec = this.vodInfo.originVodInfo.originVodChangeSecond;
        }
        else{ // 다시보기(originVodInfo) 정보가 없거나 파일이 없는 경우 (원본 영상이 구플이라서 접근이 안되는 경우 등)
            return Math.floor((globalTS - this.vodInfo.startDate.getTime()) / 1000);
        }

        if (this.isEditedVod && reviewDataFiles.length > 1 && this.vodInfo.type !== 'REVIEW'){
            this.warn(`${this.videoId}를 제보해주시기 바랍니다.\n[VOD Master 설정] > [문의하기]`);
            return null;
        }

        let cumulativeTime = 0;
        for (let i = 0; i < reviewDataFiles.length; ++i){
            const file = reviewDataFiles[i];
            const fileStartDate = new Date(file.file_start);
            const fileEndDate = new Date(fileStartDate.getTime() + file.duration);
            if (fileStartDate.getTime() <= globalTS && globalTS <= fileEndDate.getTime()){
                return Math.floor((globalTS - fileStartDate.getTime() + cumulativeTime) / 1000);
            }
            cumulativeTime += file.duration;
        }
        return null;
    }

    /** @override 전역 타임스탬프 → 재생 시각 변환 가능 여부 (vodInfo, videoTag 준비 시 true) */
    canConvertGlobalTSToPlaybackTime() {
        return this.vodInfo != null;
    }

    /**
     * @override
     * @description 현재 영상이 스트리밍된 당시 시간을 반환
     * @returns {Date} 현재 영상이 스트리밍된 당시 시간
     * @returns {null} 영상 정보를 가져올 수 없음. 의도치않은 상황 발생
     * @returns {string} 당시 시간을 계산하지 못한 오류 메시지.
     */
    getCurDateTime(){
        if (this.vodInfo == null) return null;
        const totalPlaybackSec = this.getCurPlaybackTime();
        if (totalPlaybackSec === null) return null;

        if (this.vodInfo.type === 'NORMAL')
            return '업로드 VOD는 지원하지 않습니다.';
        else if (this.vodInfo.type === "EDITOR")
            return '편집된 VOD는 지원하지 않습니다.';
        if (this.vodInfo.startDate === null && 
            this.vodInfo.endDate === null && 
            this.vodInfo.originVodInfo === null) {
                return '원본 다시보기와 연결되어 있지 않은 VOD입니다.';
        }

        const globalTS = this.playbackTimeToGlobalTS(totalPlaybackSec);
        return globalTS;
    }

    /** 다시보기·클립 등 API `files` 출처 (playbackTimeToGlobalTS와 동일). */
    _reviewDataFilesForPlayback() {
        if (!this.vodInfo) return null;
        const files = this.vodInfo.originVodInfo === null ? this.vodInfo.files : this.vodInfo.originVodInfo.files;
        if (!Array.isArray(files) || files.length === 0) return null;
        return files;
    }

    /** 재생 표시 태그 정수 초 (HH:MM:SS / MM:SS). 다중 파일일 때 어느 file인지 골 때·비디오 없을 때 폴백. */
    _parsePlayTimeTagToIntegerSec() {
        if (!this.playTimeTag) return null;
        const totalPlaybackTimeStr = this.playTimeTag.innerText.trim();
        const splitres = totalPlaybackTimeStr.split(':');
        let totalPlaybackSec = 0;
        if (splitres.length === 3) {
            totalPlaybackSec = parseInt(splitres[0], 10) * 3600 + parseInt(splitres[1], 10) * 60 + parseInt(splitres[2], 10);
        } else if (splitres.length === 2) {
            totalPlaybackSec = parseInt(splitres[0], 10) * 60 + parseInt(splitres[1], 10);
        } else {
            this.warn(`${this.videoId}를 제보해주시기 바랍니다.\n[VOD Master 설정] > [문의하기]`);
            return null;
        }
        return Number.isFinite(totalPlaybackSec) ? totalPlaybackSec : null;
    }

    /**
     * @description 현재 재생 시간을 초 단위로 반환 (전역 타임라인). `VODSync.getVodCore().playerController.playingTime` 우선.
     * `files[].duration`(ms)는 앞선 파일 길이만 ms로 누적 후 초로 바꾸고, **현재 파일 안**의 재생 위치는 항상 `videoTag.currentTime`만 쓴다.
     * 재생 표시 태그(`playTimeTag`)는 **몇 번째 파일인지** 고를 때만 쓰고, 재생 초의 소수·누적에는 섞지 않는다. 비디오를 읽을 수 없을 때만 태그 정수 초를 쓴다.
     * @returns {number} 현재 재생 시간(초)
     * @returns {null} 재생 시간을 계산할 수 없음. 의도치않은 상황 발생
     */
    getCurPlaybackTime() {
        const pa = window.VODSync?.getVodCore?.();
        const pt = pa?.playerController?.playingTime;
        if (typeof pt === 'number' && Number.isFinite(pt)) return Math.max(0, pt);

        const v = this.videoTag;
        const maxSec = this.getTotalFileDurationSec();
        const ct = v && Number.isFinite(v.currentTime) ? Math.max(0, v.currentTime) : null;
        const files = this._reviewDataFilesForPlayback();

        if (files && files.length > 0 && ct != null) {
            if (files.length === 1) {
                const maxSec = this.getTotalFileDurationSec();
                if (maxSec != null) return Math.min(maxSec, ct);
                return ct;
            }
            // playTimeTag를 사용하여 몇 번째 파일인지 판별, 이전 파일들의 duration을 누적
            const T = this._parsePlayTimeTagToIntegerSec();
            if (T === null) return null;
            const tagMs = T * 1000;
            let cumMs = 0;
            for (let i = 0; i < files.length; i++) {
                const durMs = files[i].duration;
                const endMs = cumMs + durMs;
                const isLast = i === files.length - 1;
                if (tagMs < endMs - 1e-6 || isLast) {
                    let total = Math.floor(cumMs / 1000) + ct; // 무슨 이유에선지 SOOP의 플레이어에선 앞의 파일들의 합에서 소수점을 버림
                    const maxSec = this.getTotalFileDurationSec();
                    if (maxSec != null) total = Math.max(0, Math.min(maxSec, total));
                    else total = Math.max(0, total);
                    return total;
                }
                cumMs = endMs;
            }
        }

        if (ct != null) {
            let total = ct;
            if (maxSec != null) total = Math.min(maxSec, total);
            return Math.max(0, total);
        }

        const tagSec = this._parsePlayTimeTagToIntegerSec();
        if (tagSec === null) return null;
        let totalPlaybackSec = tagSec;
        if (maxSec != null) totalPlaybackSec = Math.max(0, Math.min(maxSec, totalPlaybackSec));
        return totalPlaybackSec;
    }

    /**
     * GetSoopVodInfo 기반 전체 재생 길이(초). vodCore ghost·편집 패널 타임라인 스케일에 쓸 때 TamperMonkey 등에서 `<video>.duration` 대신 사용.
     * @returns {number|null} 로드 전·비정상이면 null
     */
    getTotalFileDurationSec() {
        if (!this.vodInfo || !Number.isFinite(this.vodInfo.total_file_duration)) return null;
        const ms = this.vodInfo.total_file_duration;
        if (ms <= 0) return null;
        return ms / 1000;
    }

    /**
     * @override
     * @description 영상 시간을 설정
     * @param {number} globalTS (milliseconds)
     * @param {boolean} doAlert 
     * @returns {boolean} 성공 여부
     */
    async moveToGlobalTS(globalTS, doAlert = true) {
        const playbackTime = await this.globalTSToPlaybackTime(globalTS);
        if (playbackTime === null) return false;
        const maxPlaybackTime = Math.floor(this.vodInfo.total_file_duration / 1000);
        if (playbackTime < 0 || playbackTime > maxPlaybackTime){
            const errorMessage = `재생 시간 범위를 벗어납니다. (${playbackTime < 0 ? playbackTime : playbackTime - maxPlaybackTime}초 초과됨)`;
            if (doAlert) 
                alert(errorMessage);
            this.warn(errorMessage);
            return false;
        }
        return this.moveToPlaybackTime(playbackTime, doAlert);
    }
    moveToPlaybackTime(playbackTime, doAlert = true) {
        if (this._timeLinkJumpIntervalId != null) {
            clearInterval(this._timeLinkJumpIntervalId);
            this._timeLinkJumpIntervalId = null;
        }

        const url = new URL(window.location.href);
        const secNum = Math.max(0, Number(playbackTime));
        const changeSec = Number.isFinite(secNum) ? Math.floor(secNum * 100) / 100 : 0;
        url.searchParams.set('change_second', String(changeSec));
        window.history.replaceState({}, '', url.toString());

        const pa = window.VODSync?.getVodCore?.();
        if (pa && typeof pa.seek === 'function') {
            const sec = Math.max(0, Number(playbackTime));
            try {
                pa.seek(Number.isFinite(sec) ? sec : 0);
                this.debug('playback seek via adapter', sec);
                return true;
            } catch (e) {
                /* ignore */
            }
        }

        /// soop 댓글 타임라인 기능 (adapter·시크 불가 시 폴백)
        const targetSec = playbackTime;
        this._timeLinkJumpIntervalId = setInterval(() => {
            if (Math.abs(this.getCurPlaybackTime() - targetSec) <= 1) {
                if (this._timeLinkJumpIntervalId != null) {
                    clearInterval(this._timeLinkJumpIntervalId);
                    this._timeLinkJumpIntervalId = null;
                }
                return;
            }
            if (this.timeLink === null) {
                this.timeLink = document.createElement('a');
                document.body.appendChild(this.timeLink);
            }
            this.timeLink.className = 'time_link';
            this.timeLink.setAttribute('data-time', targetSec.toString());
            this.timeLink.click();
            this.debug('timeLink 클릭됨');
        }, 500);
        return true;
    }
    // 현재 재생 중인지 여부 반환
    isPlaying() {
        if (this.videoTag) {
            return !this.videoTag.paused;
        }
        return false;
    }
} 
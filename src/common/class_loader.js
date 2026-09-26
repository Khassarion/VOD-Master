// 범용 클래스 로더 - 각 content script에서 필요한 클래스들을 직접 구성
class ClassLoader {
    constructor() {
        this.loadedClasses = new Map();
        // 클래스 의존성 정의 (파생 클래스 -> 부모 클래스)
        this.dependencies = {
            'VODLinkerBase': ['IVodSync'],
            'TimestampManagerBase': ['IVodSync'],
            'SoopTimestampManager': ['TimestampManagerBase'],
            'ChzzkTimestampManager': ['TimestampManagerBase'],
            'OtherPlatformSyncPanel': ['IVodSync'],
            'RPNicknamePanel': ['IVodSync'],
            'SoopVODLinker': ['VODLinkerBase'],
            'ChzzkVODLinker': ['VODLinkerBase'],
            'SoopAPI': ['IVodSync'],
            'ChzzkAPI': ['IVodSync'],
            'SoopPrevChatViewer': ['IVodSync'],
            'SoopTimelineCommentProcessor': ['TimelineCommentProcessorBase'],
            'ChzzkTimelineCommentProcessor': ['TimelineCommentProcessorBase'],
            'SoopLiveWatchCommentNotifier': ['IVodSync'],
            'SoopNextVideoAutoplayGuard': ['IVodSync'],
            'SoopVeditorReplacement': ['IVodSync'],
            'SoopClipMap': ['IVodSync'],
        };
    }

    // 클래스 파일을 동적으로 로드
    async loadClass(className, filePath) {
        if (this.loadedClasses.has(className)) {
            return this.loadedClasses.get(className);
        }

        // 의존성이 있는 경우 먼저 부모 클래스들을 로드
        if (this.dependencies[className]) {
            for (const parentClass of this.dependencies[className]) {
                if (!this.loadedClasses.has(parentClass)) {
                    await this.loadParentClass(parentClass);
                }
            }
        }

        try {
            // 동적 import를 사용하여 클래스 로드
            const module = await import(chrome.runtime.getURL(filePath));
            const ClassConstructor = module[className] || module.default;
            
            if (ClassConstructor) {
                this.loadedClasses.set(className, ClassConstructor);
                return ClassConstructor;
            } else {
                throw new Error(`Class ${className} not found in ${filePath}`);
            }
        } catch (error) {
            console.error(`Failed to load class ${className} from ${filePath}:`, error);
            throw error;
        }
    }

    // 부모 클래스 로드 (재귀 방지)
    async loadParentClass(parentClassName) {
        if (this.loadedClasses.has(parentClassName)) {
            return this.loadedClasses.get(parentClassName);
        }

        const parentClassPaths = {
            'IVodSync': 'src/module/interface4log.js',
            'VODLinkerBase': 'src/module/base_vod_linker.js',
            'TimestampManagerBase': 'src/module/base_timestamp_manager.js',
            'TimelineCommentProcessorBase': 'src/module/base_timeline_comment_processor.js',
        };

        const filePath = parentClassPaths[parentClassName];
        if (!filePath) {
            throw new Error(`Parent class path not found for ${parentClassName}`);
        }

        try {
            // 동적 import를 사용하여 부모 클래스 로드 (재귀 없이)
            const module = await import(chrome.runtime.getURL(filePath));
            const ClassConstructor = module[parentClassName] || module.default;
            
            if (ClassConstructor) {
                this.loadedClasses.set(parentClassName, ClassConstructor);
                return ClassConstructor;
            } else {
                throw new Error(`Parent class ${parentClassName} not found in ${filePath}`);
            }
        } catch (error) {
            console.error(`Failed to load parent class ${parentClassName} from ${filePath}:`, error);
            throw error;
        }
    }

    // 사용자가 지정한 클래스들을 로드 (의존성 자동 처리)
    async loadClasses(classConfig) {
        const classes = {};
        
        for (const [className, filePath] of Object.entries(classConfig)) {
            classes[className] = await this.loadClass(className, filePath);
        }
        
        return classes;
    }
}

// VODSync 네임스페이스에 ClassLoader 인스턴스 생성
window.VODSync = window.VODSync || {};
if (window.VODSync.classLoader) {
    console.warn('[VODSync] ClassLoader가 이미 존재합니다. 기존 인스턴스를 덮어씁니다.');
}
window.VODSync.classLoader = new ClassLoader(); 
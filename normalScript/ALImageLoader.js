var ALImageLoader = (function(){
    var ERROR = {
        DOWNLOAD_ERROR: {code:-101,msg:"download file error"},     //下载错误
        DOWNLOAD_FAILED : {code:-102,msg:"download file failed"},  //下载失败
        REMOTE_FILE_ERROR: {code:-103,msg:"remote file error"},    //远端文件错误 
        WRITE_FAILED : {code:-201,msg:"write file failed"},        //远端文件写入本地失败
        READ_FAILED : {code:-202,msg:"read file failed"},          //加载本地文件失败
    };


    // 数据配置
    var _config = {
        MAX_TASKS:5,      // 最大同步任务数量
    };

    var self = {
        // 默认配置
        _options:{
            tasks_limit:_config.MAX_TASKS, //最大同步任务数量
        },
        _tasks:[],          // 任务列表
        _taskCallbacks:{},  // 任务列表回调
        _run_tasks:[],      // 正在执行的任务列表
        _images:{},         // 已经加载完成的image (spriteFrame)

        loadRemoteImage:function(url,callback){
            // 查询是否已经在内存中
            let sf = self._query(url);
            if(sf){
                callback(null,url,sf);
                return true;
            }
            // 判断任务是否已经在下载，或者正在下载
            let loadItem = {url:url,callback:callback};
            self._add(loadItem);
        },

        /**
         * 释放已经加载的图片（此处的释放 要确保其他地方不被引用）
         * @param {*} url 
         */
        releaseImage:function(url){
            self._remove(url);
        },

        
        //======================================= function  ===================================
        /**
         * 添加加载任务
         * @param {加载任务} loadItem:{url:"远程连接",callback:"回调函数"}
         */
        _add:function(loadItem){
            // 查询任务列表中是否有相同的url 如果有的话,将回调函数添加到对应列表中
            if(self._fetched(loadItem.url)){
                if(loadItem.callback){
                    try {
                        self._taskCallbacks[loadItem.url].push(loadItem.callback);
                    } catch (error) {
                        cc.error(error);
                    }
                    
                } 
            }else{
                self._tasks.push(loadItem.url);
                let callbacks = [];
                callbacks.push(loadItem.callback);
                self._taskCallbacks[loadItem.url] = callbacks;

            }

            self._doQueue();
        },
        _remove:function(url){
            let md5URL = ALMD5.hex_md5(url);
            if(self._images[md5URL]){
                delete self._images[md5URL];
                // TODO: 这里需要 从 cc.loader 中释放资源。
            }
        },
        /**
         * 查询图片是否已经加载
         * @param {*} url 
         */
        _query:function(url){
            let md5URL = ALMD5.hex_md5(url);
            if(self._images[md5URL]){
                return self._images[md5URL];
            }
            return null;
        },
        /**
         * 判断任务是否任务列表中
         * @param {*} url 
         */
        _fetched:function(url){
            return (self._tasks.indexOf(url) !== -1 || self._run_tasks.indexOf(url) !== -1);
        },
        /**
         * 判断是否有空闲队列位置
         */
        _idle:function(){
            return (self._run_tasks.length < self._options.tasks_limit)
        },

        _getNextTask:function(){
            if(self._tasks.length > 0){
                let task = self._tasks[0];
                self._tasks.splice(0,1);
                return task;
            }else{
                return null;
            }
        },

        /**
         * 将任务加载到执行队列中
         * @param {*} url 
         */
        _doLoad:function(url){
            self._run_tasks.push(url);
            if(jsb){
                let dirpath =  jsb.fileUtils.getWritablePath() + 'customImage/';
                cc.log("dirpath ->",dirpath);
                let md5URL = ALMD5.hex_md5(url);
                let filepath = dirpath + md5URL + ".png";
                cc.log("filepath -> " + filepath);

                // 加载结束
                function loadEnd(){
                    cc.loader.load(filepath,function(err,texture){
                        if(err){
                            self._doTaskFinish(ERROR.READ_FAILED,url,null);
                        }else{
                            let sf = new cc.SpriteFrame(texture,cc.Rect(0,0,texture.width,texture.height));
                            self._doTaskFinish(null,url,sf);
                        }
                    })
                }
                // 如果本地找到了文件
                if(jsb.fileUtils.isFileExist(filepath)){
                    cc.log('Remote is find ' + filepath);
                    loadEnd()
                    return;
                }

                // 储存文件
                function saveFile(data){
                    if(data){
                        if(!jsb.fileUtils.isDirectoryExist(dirpath)){
                            jsb.fileUtils.createDirectory(dirpath);
                        }
                        if(jsb.fileUtils.writeDataToFile(new Uint8Array(data),filepath)){
                            cc.log("Remote write file successed");
                            loadEnd();
                        }else{
                            cc.log("Remote write file failed");
                            self._doTaskFinish(ERROR.WRITE_FAILED,url,null);
                        }
                        
                    }else{
                        cc.log("Download file failed");
                        self._doTaskFinish(ERROR.REMOTE_FILE_ERROR,url,null);
                    }
                }

                // 下载
                let xhr = cc.loader.getXMLHttpRequest();
                xhr.onreadystatechange = function(){
                    if(xhr.readyState == 4){
                        cc.log("status ==== " + xhr.status);
                        if(xhr.status >= 200 && xhr.status < 400){
                            var response = xhr.response;
                            saveFile(response);
                        }else{
                            self._doTaskFinish(ERROR.DOWNLOAD_ERROR,url,null);
                        }
                    }
                }.bind(this);
                let errCallback = function(event){
                    cc.log("image 请求出错 或者 超时");
                    self._doTaskFinish(ERROR.DOWNLOAD_FAILED,url,null);
                }
                xhr.responseType = 'arraybuffer';
                xhr.ontimeout = errCallback;
                xhr.onerror = errCallback;
                xhr.timeout = 5000;
                xhr.open("GET",url,true);
                xhr.send();
            }else{
                cc.loader.load(url,function(err,texture){
                    if(err){
                        self._doTaskFinish(ERROR.READ_FAILED,url,null);
                    }else{
                        var sf = new cc.SpriteFrame(texture,cc.Rect(0,0,texture.width,texture.height));
                        self._doTaskFinish(null,url,sf);
                    }
                });
            }
        },

        /**
         * 任务完成 
         * @param {*} err 
         * @param {*} url 
         */
        _doTaskFinish:function(err,url,sf){
            // 添加到缓存中
            if(!err && url && sf){
                let md5URL = ALMD5.hex_md5(url);
                self._images[md5URL] = sf;
            }
            // 移除任务列表中的任务
            try {

                // 执行回调函数
                let callbacks = self._taskCallbacks[url];

                // 移除回调
                delete self._taskCallbacks[url]
                // 删除执行任务中的任务
                let tIndex = self._run_tasks.indexOf(url);
                if(tIndex !== -1){
                    self._run_tasks.splice(tIndex,1);
                }else{
                    cc.error("当前任务的url 找不到");
                }

                // 执行回调函数
                if(callbacks && Array.isArray(callbacks)){
                    for(let i = 0; i < callbacks.length; ++i){
                        let cb = callbacks[i];
                        if(cb) cb(err,url,sf);
                    }
                }
            } catch (error) {
                cc.error(error);
            }

            // 执行下一任务
            self._doQueue();
        },

        /**
         * 执行下载任务队列
         */
        _doQueue:function(){
            let count = 0;
            while(self._idle()){
                let nextTask = self._getNextTask();
                if(!nextTask) break;
                self._doLoad(nextTask);
                count++;
            }
            return count;
        },
        
    };

    return self;
})();

module.exports = ALImageLoader;
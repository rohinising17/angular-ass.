(function(window, angular) {

'use strict';
angular.mock = {};
angular.mock.$BrowserProvider = function() {
  this.$get = function() {
    return new angular.mock.$Browser();
  };
};

angular.mock.$Browser = function() {
  var self = this;

  this.isMock = true;
  self.$$url = "http://server/";
  self.$$lastUrl = self.$$url; // used by url polling fn
  self.pollFns = [];

  // TODO(vojta): remove this temporary api
  self.$$completeOutstandingRequest = angular.noop;
  self.$$incOutstandingRequestCount = angular.noop;


  // register url polling fn

  self.onUrlChange = function(listener) {
    self.pollFns.push(
      function() {
        if (self.$$lastUrl !== self.$$url || self.$$state !== self.$$lastState) {
          self.$$lastUrl = self.$$url;
          self.$$lastState = self.$$state;
          listener(self.$$url, self.$$state);
        }
      }
    );

    return listener;
  };

  self.$$applicationDestroyed = angular.noop;
  self.$$checkUrlChange = angular.noop;

  self.deferredFns = [];
  self.deferredNextId = 0;

  self.defer = function(fn, delay) {
    delay = delay || 0;
    self.deferredFns.push({time:(self.defer.now + delay), fn:fn, id: self.deferredNextId});
    self.deferredFns.sort(function(a, b) { return a.time - b.time;});
    return self.deferredNextId++;
  };
  self.defer.now = 0;


  self.defer.cancel = function(deferId) {
    var fnIndex;

    angular.forEach(self.deferredFns, function(fn, index) {
      if (fn.id === deferId) fnIndex = index;
    });

    if (angular.isDefined(fnIndex)) {
      self.deferredFns.splice(fnIndex, 1);
      return true;
    }

    return false;
  };
  self.defer.flush = function(delay) {
    var nextTime;

    if (angular.isDefined(delay)) {
      // A delay was passed so compute the next time
      nextTime = self.defer.now + delay;
    } else {
      if (self.deferredFns.length) {
        // No delay was passed so set the next time so that it clears the deferred queue
        nextTime = self.deferredFns[self.deferredFns.length - 1].time;
      } else {
        // No delay passed, but there are no deferred tasks so flush - indicates an error!
        throw new Error('No deferred tasks to be flushed');
      }
    }

    while (self.deferredFns.length && self.deferredFns[0].time <= nextTime) {
      // Increment the time and call the next deferred function
      self.defer.now = self.deferredFns[0].time;
      self.deferredFns.shift().fn();
    }

    // Ensure that the current time is correct
    self.defer.now = nextTime;
  };

  self.$$baseHref = '/';
  self.baseHref = function() {
    return this.$$baseHref;
  };
};
angular.mock.$Browser.prototype = {
  poll: function poll() {
    angular.forEach(this.pollFns, function(pollFn) {
      pollFn();
    });
  },

  url: function(url, replace, state) {
    if (angular.isUndefined(state)) {
      state = null;
    }
    if (url) {
      this.$$url = url;
      // Native pushState serializes & copies the object; simulate it.
      this.$$state = angular.copy(state);
      return this;
    }

    return this.$$url;
  },

  state: function() {
    return this.$$state;
  },

  notifyWhenNoOutstandingRequests: function(fn) {
    fn();
  }
};

angular.mock.$ExceptionHandlerProvider = function() {
  var handler;
  this.mode = function(mode) {

    switch (mode) {
      case 'log':
      case 'rethrow':
        var errors = [];
        handler = function(e) {
          if (arguments.length == 1) {
            errors.push(e);
          } else {
            errors.push([].slice.call(arguments, 0));
          }
          if (mode === "rethrow") {
            throw e;
          }
        };
        handler.errors = errors;
        break;
      default:
        throw new Error("Unknown mode '" + mode + "', only 'log'/'rethrow' modes are allowed!");
    }
  };

  this.$get = function() {
    return handler;
  };

  this.mode('rethrow');
};

angular.mock.$LogProvider = function() {
  var debug = true;

  function concat(array1, array2, index) {
    return array1.concat(Array.prototype.slice.call(array2, index));
  }

  this.debugEnabled = function(flag) {
    if (angular.isDefined(flag)) {
      debug = flag;
      return this;
    } else {
      return debug;
    }
  };

  this.$get = function() {
    var $log = {
      log: function() { $log.log.logs.push(concat([], arguments, 0)); },
      warn: function() { $log.warn.logs.push(concat([], arguments, 0)); },
      info: function() { $log.info.logs.push(concat([], arguments, 0)); },
      error: function() { $log.error.logs.push(concat([], arguments, 0)); },
      debug: function() {
        if (debug) {
          $log.debug.logs.push(concat([], arguments, 0));
        }
      }
    };
    $log.assertEmpty = function() {
      var errors = [];
      angular.forEach(['error', 'warn', 'info', 'log', 'debug'], function(logLevel) {
        angular.forEach($log[logLevel].logs, function(log) {
          angular.forEach(log, function(logItem) {
            errors.push('MOCK $log (' + logLevel + '): ' + String(logItem) + '\n' +
                        (logItem.stack || ''));
          });
        });
      });
      if (errors.length) {
        errors.unshift("Expected $log to be empty! Either a message was logged unexpectedly, or " +
          "an expected log message was not checked and removed:");
        errors.push('');
        throw new Error(errors.join('\n---------\n'));
      }
    };

    $log.reset();
    return $log;
  };
};
angular.mock.$IntervalProvider = function() {
  this.$get = ['$browser', '$rootScope', '$q', '$$q',
       function($browser,   $rootScope,   $q,   $$q) {
    var repeatFns = [],
        nextRepeatId = 0,
        now = 0;

    var $interval = function(fn, delay, count, invokeApply) {
      var hasParams = arguments.length > 4,
          args = hasParams ? Array.prototype.slice.call(arguments, 4) : [],
          iteration = 0,
          skipApply = (angular.isDefined(invokeApply) && !invokeApply),
          deferred = (skipApply ? $$q : $q).defer(),
          promise = deferred.promise;

      count = (angular.isDefined(count)) ? count : 0;
      promise.then(null, null, (!hasParams) ? fn : function() {
        fn.apply(null, args);
      });

      promise.$$intervalId = nextRepeatId;

      function tick() {
        deferred.notify(iteration++);

        if (count > 0 && iteration >= count) {
          var fnIndex;
          deferred.resolve(iteration);

          angular.forEach(repeatFns, function(fn, index) {
            if (fn.id === promise.$$intervalId) fnIndex = index;
          });

          if (angular.isDefined(fnIndex)) {
            repeatFns.splice(fnIndex, 1);
          }
        }

        if (skipApply) {
          $browser.defer.flush();
        } else {
          $rootScope.$apply();
        }
      }

      repeatFns.push({
        nextTime:(now + delay),
        delay: delay,
        fn: tick,
        id: nextRepeatId,
        deferred: deferred
      });
      repeatFns.sort(function(a, b) { return a.nextTime - b.nextTime;});

      nextRepeatId++;
      return promise;
    };
        $interval.cancel = function(promise) {
      if (!promise) return false;
      var fnIndex;

      angular.forEach(repeatFns, function(fn, index) {
        if (fn.id === promise.$$intervalId) fnIndex = index;
      });

      if (angular.isDefined(fnIndex)) {
        repeatFns[fnIndex].deferred.reject('canceled');
        repeatFns.splice(fnIndex, 1);
        return true;
      }

      return false;
    };
    $interval.flush = function(millis) {
      now += millis;
      while (repeatFns.length && repeatFns[0].nextTime <= now) {
        var task = repeatFns[0];
        task.fn();
        task.nextTime += task.delay;
        repeatFns.sort(function(a, b) { return a.nextTime - b.nextTime;});
      }
      return millis;
    };

    return $interval;
  }];
};
var R_ISO8061_STR = /^(-?\d{4})-?(\d\d)-?(\d\d)(?:T(\d\d)(?:\:?(\d\d)(?:\:?(\d\d)(?:\.(\d{3}))?)?)?(Z|([+-])(\d\d):?(\d\d)))?$/;

function jsonStringToDate(string) {
  var match;
  if (match = string.match(R_ISO8061_STR)) {
    var date = new Date(0),
        tzHour = 0,
        tzMin  = 0;
    if (match[9]) {
      tzHour = toInt(match[9] + match[10]);
      tzMin = toInt(match[9] + match[11]);
    }
    date.setUTCFullYear(toInt(match[1]), toInt(match[2]) - 1, toInt(match[3]));
    date.setUTCHours(toInt(match[4] || 0) - tzHour,
                     toInt(match[5] || 0) - tzMin,
                     toInt(match[6] || 0),
                     toInt(match[7] || 0));
    return date;
  }
  return string;
}

function toInt(str) {
  return parseInt(str, 10);
}

function padNumberInMock(num, digits, trim) {
  var neg = '';
  if (num < 0) {
    neg =  '-';
    num = -num;
  }
  num = '' + num;
  while (num.length < digits) num = '0' + num;
  if (trim) {
    num = num.substr(num.length - digits);
  }
  return neg + num;
}
angular.mock.TzDate = function(offset, timestamp) {
  var self = new Date(0);
  if (angular.isString(timestamp)) {
    var tsStr = timestamp;

    self.origDate = jsonStringToDate(timestamp);

    timestamp = self.origDate.getTime();
    if (isNaN(timestamp)) {
      throw {
        name: "Illegal Argument",
        message: "Arg '" + tsStr + "' passed into TzDate constructor is not a valid date string"
      };
    }
  } else {
    self.origDate = new Date(timestamp);
  }

  var localOffset = new Date(timestamp).getTimezoneOffset();
  self.offsetDiff = localOffset * 60 * 1000 - offset * 1000 * 60 * 60;
  self.date = new Date(timestamp + self.offsetDiff);

  self.getTime = function() {
    return self.date.getTime() - self.offsetDiff;
  };

  self.toLocaleDateString = function() {
    return self.date.toLocaleDateString();
  };

  self.getFullYear = function() {
    return self.date.getFullYear();
  };

  self.getMonth = function() {
    return self.date.getMonth();
  };

  self.getDate = function() {
    return self.date.getDate();
  };

  self.getHours = function() {
    return self.date.getHours();
  };

  self.getMinutes = function() {
    return self.date.getMinutes();
  };

  self.getSeconds = function() {
    return self.date.getSeconds();
  };

  self.getMilliseconds = function() {
    return self.date.getMilliseconds();
  };

  self.getTimezoneOffset = function() {
    return offset * 60;
  };

  self.getUTCFullYear = function() {
    return self.origDate.getUTCFullYear();
  };

  self.getUTCMonth = function() {
    return self.origDate.getUTCMonth();
  };

  self.getUTCDate = function() {
    return self.origDate.getUTCDate();
  };

  self.getUTCHours = function() {
    return self.origDate.getUTCHours();
  };

  self.getUTCMinutes = function() {
    return self.origDate.getUTCMinutes();
  };

  self.getUTCSeconds = function() {
    return self.origDate.getUTCSeconds();
  };

  self.getUTCMilliseconds = function() {
    return self.origDate.getUTCMilliseconds();
  };

  self.getDay = function() {
    return self.date.getDay();
  };

  // provide this method only on browsers that already have it
  if (self.toISOString) {
    self.toISOString = function() {
      return padNumberInMock(self.origDate.getUTCFullYear(), 4) + '-' +
            padNumberInMock(self.origDate.getUTCMonth() + 1, 2) + '-' +
            padNumberInMock(self.origDate.getUTCDate(), 2) + 'T' +
            padNumberInMock(self.origDate.getUTCHours(), 2) + ':' +
            padNumberInMock(self.origDate.getUTCMinutes(), 2) + ':' +
            padNumberInMock(self.origDate.getUTCSeconds(), 2) + '.' +
            padNumberInMock(self.origDate.getUTCMilliseconds(), 3) + 'Z';
    };
  }

  //hide all methods not implemented in this mock that the Date prototype exposes
  var unimplementedMethods = ['getUTCDay',
      'getYear', 'setDate', 'setFullYear', 'setHours', 'setMilliseconds',
      'setMinutes', 'setMonth', 'setSeconds', 'setTime', 'setUTCDate', 'setUTCFullYear',
      'setUTCHours', 'setUTCMilliseconds', 'setUTCMinutes', 'setUTCMonth', 'setUTCSeconds',
      'setYear', 'toDateString', 'toGMTString', 'toJSON', 'toLocaleFormat', 'toLocaleString',
      'toLocaleTimeString', 'toSource', 'toString', 'toTimeString', 'toUTCString', 'valueOf'];

  angular.forEach(unimplementedMethods, function(methodName) {
    self[methodName] = function() {
      throw new Error("Method '" + methodName + "' is not implemented in the TzDate mock");
    };
  });

  return self;
};

//make "tzDateInstance instanceof Date" return true
angular.mock.TzDate.prototype = Date.prototype;
angular.mock.animate = angular.module('ngAnimateMock', ['ng'])

  .config(['$provide', function($provide) {

    $provide.factory('$$forceReflow', function() {
      function reflowFn() {
        reflowFn.totalReflows++;
      }
      reflowFn.totalReflows = 0;
      return reflowFn;
    });

    $provide.factory('$$animateAsyncRun', function() {
      var queue = [];
      var queueFn = function() {
        return function(fn) {
          queue.push(fn);
        };
      };
      queueFn.flush = function() {
        if (queue.length === 0) return false;

        for (var i = 0; i < queue.length; i++) {
          queue[i]();
        }
        queue = [];

        return true;
      };
      return queueFn;
    });

    $provide.decorator('$$animateJs', ['$delegate', function($delegate) {
      var runners = [];

      var animateJsConstructor = function() {
        var animator = $delegate.apply($delegate, arguments);
        // If no javascript animation is found, animator is undefined
        if (animator) {
          runners.push(animator);
        }
        return animator;
      };

      animateJsConstructor.$closeAndFlush = function() {
        runners.forEach(function(runner) {
          runner.end();
        });
        runners = [];
      };

      return animateJsConstructor;
    }]);

    $provide.decorator('$animateCss', ['$delegate', function($delegate) {
      var runners = [];

      var animateCssConstructor = function(element, options) {
        var animator = $delegate(element, options);
        runners.push(animator);
        return animator;
      };

      animateCssConstructor.$closeAndFlush = function() {
        runners.forEach(function(runner) {
          runner.end();
        });
        runners = [];
      };

      return animateCssConstructor;
    }]);

    $provide.decorator('$animate', ['$delegate', '$timeout', '$browser', '$$rAF', '$animateCss', '$$animateJs',
                                    '$$forceReflow', '$$animateAsyncRun', '$rootScope',
                            function($delegate,   $timeout,   $browser,   $$rAF,   $animateCss,   $$animateJs,
                                     $$forceReflow,   $$animateAsyncRun,  $rootScope) {
      var animate = {
        queue: [],
        cancel: $delegate.cancel,
        on: $delegate.on,
        off: $delegate.off,
        pin: $delegate.pin,
        get reflows() {
          return $$forceReflow.totalReflows;
        },
        enabled: $delegate.enabled,
                closeAndFlush: function() {
          // we allow the flush command to swallow the errors
          // because depending on whether CSS or JS animations are
          // used, there may not be a RAF flush. The primary flush
          // at the end of this function must throw an exception
          // because it will track if there were pending animations
          this.flush(true);
          $animateCss.$closeAndFlush();
          $$animateJs.$closeAndFlush();
          this.flush();
        },
                flush: function(hideErrors) {
          $rootScope.$digest();

          var doNextRun, somethingFlushed = false;
          do {
            doNextRun = false;

            if ($$rAF.queue.length) {
              $$rAF.flush();
              doNextRun = somethingFlushed = true;
            }

            if ($$animateAsyncRun.flush()) {
              doNextRun = somethingFlushed = true;
            }
          } while (doNextRun);

          if (!somethingFlushed && !hideErrors) {
            throw new Error('No pending animations ready to be closed or flushed');
          }

          $rootScope.$digest();
        }
      };

      angular.forEach(
        ['animate','enter','leave','move','addClass','removeClass','setClass'], function(method) {
        animate[method] = function() {
          animate.queue.push({
            event: method,
            element: arguments[0],
            options: arguments[arguments.length - 1],
            args: arguments
          });
          return $delegate[method].apply($delegate, arguments);
        };
      });

      return animate;
    }]);

  }]);
angular.mock.dump = function(object) {
  return serialize(object);

  function serialize(object) {
    var out;

    if (angular.isElement(object)) {
      object = angular.element(object);
      out = angular.element('<div></div>');
      angular.forEach(object, function(element) {
        out.append(angular.element(element).clone());
      });
      out = out.html();
    } else if (angular.isArray(object)) {
      out = [];
      angular.forEach(object, function(o) {
        out.push(serialize(o));
      });
      out = '[ ' + out.join(', ') + ' ]';
    } else if (angular.isObject(object)) {
      if (angular.isFunction(object.$eval) && angular.isFunction(object.$apply)) {
        out = serializeScope(object);
      } else if (object instanceof Error) {
        out = object.stack || ('' + object.name + ': ' + object.message);
      } else {
        // TODO(i): this prevents methods being logged,
        // we should have a better way to serialize objects
        out = angular.toJson(object, true);
      }
    } else {
      out = String(object);
    }

    return out;
  }

  function serializeScope(scope, offset) {
    offset = offset ||  '  ';
    var log = [offset + 'Scope(' + scope.$id + '): {'];
    for (var key in scope) {
      if (Object.prototype.hasOwnProperty.call(scope, key) && !key.match(/^(\$|this)/)) {
        log.push('  ' + key + ': ' + angular.toJson(scope[key]));
      }
    }
    var child = scope.$$childHead;
    while (child) {
      log.push(serializeScope(child, offset + '  '));
      child = child.$$nextSibling;
    }
    log.push('}');
    return log.join('\n' + offset);
  }
};
  ```js
  // The module code
  angular
    .module('MyApp', [])
    .controller('MyController', MyController);
  // The controller code
  function MyController($scope, $http) {
    var authToken;
    $http.get('/auth.py').then(function(response) {
      authToken = response.headers('A-Token');
      $scope.user = response.data;
    });
    $scope.saveMessage = function(message) {
      var headers = { 'Authorization': authToken };
      $scope.status = 'Saving...';
      $http.post('/add-msg.py', message, { headers: headers } ).then(function(response) {
        $scope.status = '';
      }).catch(function() {
        $scope.status = 'Failed...';
      });
    };
  }
  ```
  ```js
    // testing controller
    describe('MyController', function() {
       var $httpBackend, $rootScope, createController, authRequestHandler;
       // Set up the module
       beforeEach(module('MyApp'));
       beforeEach(inject(function($injector) {
         // Set up the mock http service responses
         $httpBackend = $injector.get('$httpBackend');
         // backend definition common for all tests
         authRequestHandler = $httpBackend.when('GET', '/auth.py')
                                .respond({userId: 'userX'}, {'A-Token': 'xxx'});
         // Get hold of a scope (i.e. the root scope)
         $rootScope = $injector.get('$rootScope');
         // The $controller service is used to create instances of controllers
         var $controller = $injector.get('$controller');
         createController = function() {
           return $controller('MyController', {'$scope' : $rootScope });
         };
       }));
       afterEach(function() {
         $httpBackend.verifyNoOutstandingExpectation();
         $httpBackend.verifyNoOutstandingRequest();
       });
       it('should fetch authentication token', function() {
         $httpBackend.expectGET('/auth.py');
         var controller = createController();
         $httpBackend.flush();
       });
       it('should fail authentication', function() {
         // Notice how you can change the response even after it was set
         authRequestHandler.respond(401, '');
         $httpBackend.expectGET('/auth.py');
         var controller = createController();
         $httpBackend.flush();
         expect($rootScope.status).toBe('Failed...');
       });
       it('should send msg to server', function() {
         var controller = createController();
         $httpBackend.flush();
         // now you don’t care about the authentication, but
         // the controller will still send the request and
         // $httpBackend will respond without you having to
         // specify the expectation and response for this request
         $httpBackend.expectPOST('/add-msg.py', 'message content').respond(201, '');
         $rootScope.saveMessage('message content');
         expect($rootScope.status).toBe('Saving...');
         $httpBackend.flush();
         expect($rootScope.status).toBe('');
       });
       it('should send auth header', function() {
         var controller = createController();
         $httpBackend.flush();
         $httpBackend.expectPOST('/add-msg.py', undefined, function(headers) {
           // check if the header was sent, if it wasn't the expectation won't
           // match the request and the test will fail
           return headers['Authorization'] == 'xxx';
         }).respond(201, '');
         $rootScope.saveMessage('whatever');
         $httpBackend.flush();
       });
    });
  ```
   ```js
    $httpBackend.whenRoute('GET', '/users/:id')
      .respond(function(method, url, data, headers, params) {
        return [200, MockUserList[Number(params.id)]];
      });
    $httpBackend.whenRoute('GET', '/users')
      .respond(function(method, url, data, headers, params) {
        var userList = angular.copy(MockUserList),
          defaultSort = 'lastName',
          count, pages, isPrevious, isNext;
        // paged api response '/v1/users?page=2'
        params.page = Number(params.page) || 1;
        // query for last names '/v1/users?q=Archer'
        if (params.q) {
          userList = $filter('filter')({lastName: params.q});
        }
        pages = Math.ceil(userList.length / pagingLength);
        isPrevious = params.page > 1;
        isNext = params.page < pages;
        return [200, {
          count:    userList.length,
          previous: isPrevious,
          next:     isNext,
          // sort field -> '/v1/users?sortBy=firstName'
          results:  $filter('orderBy')(userList, params.sortBy || defaultSort)
                      .splice((params.page - 1) * pagingLength, pagingLength)
        }];
      });
  ```
 
angular.mock.$HttpBackendProvider = function() {
  this.$get = ['$rootScope', '$timeout', createHttpBackendMock];
};

function createHttpBackendMock($rootScope, $timeout, $delegate, $browser) {
  var definitions = [],
      expectations = [],
      responses = [],
      responsesPush = angular.bind(responses, responses.push),
      copy = angular.copy;

  function createResponse(status, data, headers, statusText) {
    if (angular.isFunction(status)) return status;

    return function() {
      return angular.isNumber(status)
          ? [status, data, headers, statusText]
          : [200, status, data, headers];
    };
  }

  // TODO(vojta): change params to: method, url, data, headers, callback
  function $httpBackend(method, url, data, callback, headers, timeout, withCredentials, responseType, eventHandlers, uploadEventHandlers) {

    var xhr = new MockXhr(),
        expectation = expectations[0],
        wasExpected = false;

    xhr.$$events = eventHandlers;
    xhr.upload.$$events = uploadEventHandlers;

    function prettyPrint(data) {
      return (angular.isString(data) || angular.isFunction(data) || data instanceof RegExp)
          ? data
          : angular.toJson(data);
    }

    function wrapResponse(wrapped) {
      if (!$browser && timeout) {
        timeout.then ? timeout.then(handleTimeout) : $timeout(handleTimeout, timeout);
      }

      return handleResponse;

      function handleResponse() {
        var response = wrapped.response(method, url, data, headers, wrapped.params(url));
        xhr.$$respHeaders = response[2];
        callback(copy(response[0]), copy(response[1]), xhr.getAllResponseHeaders(),
                 copy(response[3] || ''));
      }

      function handleTimeout() {
        for (var i = 0, ii = responses.length; i < ii; i++) {
          if (responses[i] === handleResponse) {
            responses.splice(i, 1);
            callback(-1, undefined, '');
            break;
          }
        }
      }
    }

    if (expectation && expectation.match(method, url)) {
      if (!expectation.matchData(data)) {
        throw new Error('Expected ' + expectation + ' with different data\n' +
            'EXPECTED: ' + prettyPrint(expectation.data) + '\nGOT:      ' + data);
      }

      if (!expectation.matchHeaders(headers)) {
        throw new Error('Expected ' + expectation + ' with different headers\n' +
                        'EXPECTED: ' + prettyPrint(expectation.headers) + '\nGOT:      ' +
                        prettyPrint(headers));
      }

      expectations.shift();

      if (expectation.response) {
        responses.push(wrapResponse(expectation));
        return;
      }
      wasExpected = true;
    }

    var i = -1, definition;
    while ((definition = definitions[++i])) {
      if (definition.match(method, url, data, headers || {})) {
        if (definition.response) {
          // if $browser specified, we do auto flush all requests
          ($browser ? $browser.defer : responsesPush)(wrapResponse(definition));
        } else if (definition.passThrough) {
          $delegate(method, url, data, callback, headers, timeout, withCredentials, responseType, eventHandlers, uploadEventHandlers);
        } else throw new Error('No response defined !');
        return;
      }
    }
    throw wasExpected ?
        new Error('No response defined !') :
        new Error('Unexpected request: ' + method + ' ' + url + '\n' +
                  (expectation ? 'Expected ' + expectation : 'No more request expected'));
  }

    $httpBackend.when = function(method, url, data, headers, keys) {
    var definition = new MockHttpExpectation(method, url, data, headers, keys),
        chain = {
          respond: function(status, data, headers, statusText) {
            definition.passThrough = undefined;
            definition.response = createResponse(status, data, headers, statusText);
            return chain;
          }
        };

    if ($browser) {
      chain.passThrough = function() {
        definition.response = undefined;
        definition.passThrough = true;
        return chain;
      };
    }

    definitions.push(definition);
    return chain;
  };

    $httpBackend.whenRoute = function(method, url) {
    var pathObj = parseRoute(url);
    return $httpBackend.when(method, pathObj.regexp, undefined, undefined, pathObj.keys);
  };

  function parseRoute(url) {
    var ret = {
      regexp: url
    },
    keys = ret.keys = [];

    if (!url || !angular.isString(url)) return ret;

    url = url
      .replace(/([().])/g, '\\$1')
      .replace(/(\/)?:(\w+)([\?\*])?/g, function(_, slash, key, option) {
        var optional = option === '?' ? option : null;
        var star = option === '*' ? option : null;
        keys.push({ name: key, optional: !!optional });
        slash = slash || '';
        return ''
          + (optional ? '' : slash)
          + '(?:'
          + (optional ? slash : '')
          + (star && '(.+?)' || '([^/]+)')
          + (optional || '')
          + ')'
          + (optional || '');
      })
      .replace(/([\/$\*])/g, '\\$1');

    ret.regexp = new RegExp('^' + url, 'i');
    return ret;
  }

  createShortMethods('expect');
  $httpBackend.expectRoute = function(method, url) {
    var pathObj = parseRoute(url);
    return $httpBackend.expect(method, pathObj.regexp, undefined, undefined, pathObj.keys);
  };
  $httpBackend.flush = function(count, digest) {
    if (digest !== false) $rootScope.$digest();
    if (!responses.length) throw new Error('No pending request to flush !');

    if (angular.isDefined(count) && count !== null) {
      while (count--) {
        if (!responses.length) throw new Error('No more pending request to flush !');
        responses.shift()();
      }
    } else {
      while (responses.length) {
        responses.shift()();
      }
    }
    $httpBackend.verifyNoOutstandingExpectation(digest);
  };

  $httpBackend.verifyNoOutstandingExpectation = function(digest) {
    if (digest !== false) $rootScope.$digest();
    if (expectations.length) {
      throw new Error('Unsatisfied requests: ' + expectations.join(', '));
    }
  };

  $httpBackend.verifyNoOutstandingRequest = function() {
    if (responses.length) {
      throw new Error('Unflushed requests: ' + responses.length);
    }
  };
  $httpBackend.resetExpectations = function() {
    expectations.length = 0;
    responses.length = 0;
  };

  return $httpBackend;


  function createShortMethods(prefix) {
    angular.forEach(['GET', 'DELETE', 'JSONP', 'HEAD'], function(method) {
     $httpBackend[prefix + method] = function(url, headers, keys) {
       return $httpBackend[prefix](method, url, undefined, headers, keys);
     };
    });

    angular.forEach(['PUT', 'POST', 'PATCH'], function(method) {
      $httpBackend[prefix + method] = function(url, data, headers, keys) {
        return $httpBackend[prefix](method, url, data, headers, keys);
      };
    });
  }
}

function MockHttpExpectation(method, url, data, headers, keys) {

  function getUrlParams(u) {
    var params = u.slice(u.indexOf('?') + 1).split('&');
    return params.sort();
  }

  function compareUrl(u) {
    return (url.slice(0, url.indexOf('?')) == u.slice(0, u.indexOf('?')) && getUrlParams(url).join() == getUrlParams(u).join());
  }

  this.data = data;
  this.headers = headers;

  this.match = function(m, u, d, h) {
    if (method != m) return false;
    if (!this.matchUrl(u)) return false;
    if (angular.isDefined(d) && !this.matchData(d)) return false;
    if (angular.isDefined(h) && !this.matchHeaders(h)) return false;
    return true;
  };

  this.matchUrl = function(u) {
    if (!url) return true;
    if (angular.isFunction(url.test)) return url.test(u);
    if (angular.isFunction(url)) return url(u);
    return (url == u || compareUrl(u));
  };

  this.matchHeaders = function(h) {
    if (angular.isUndefined(headers)) return true;
    if (angular.isFunction(headers)) return headers(h);
    return angular.equals(headers, h);
  };

  this.matchData = function(d) {
    if (angular.isUndefined(data)) return true;
    if (data && angular.isFunction(data.test)) return data.test(d);
    if (data && angular.isFunction(data)) return data(d);
    if (data && !angular.isString(data)) {
      return angular.equals(angular.fromJson(angular.toJson(data)), angular.fromJson(d));
    }
    return data == d;
  };

  this.toString = function() {
    return method + ' ' + url;
  };

  this.params = function(u) {
    return angular.extend(parseQuery(), pathParams());

    function pathParams() {
      var keyObj = {};
      if (!url || !angular.isFunction(url.test) || !keys || keys.length === 0) return keyObj;

      var m = url.exec(u);
      if (!m) return keyObj;
      for (var i = 1, len = m.length; i < len; ++i) {
        var key = keys[i - 1];
        var val = m[i];
        if (key && val) {
          keyObj[key.name || key] = val;
        }
      }

      return keyObj;
    }

    function parseQuery() {
      var obj = {}, key_value, key,
          queryStr = u.indexOf('?') > -1
          ? u.substring(u.indexOf('?') + 1)
          : "";

      angular.forEach(queryStr.split('&'), function(keyValue) {
        if (keyValue) {
          key_value = keyValue.replace(/\+/g,'%20').split('=');
          key = tryDecodeURIComponent(key_value[0]);
          if (angular.isDefined(key)) {
            var val = angular.isDefined(key_value[1]) ? tryDecodeURIComponent(key_value[1]) : true;
            if (!hasOwnProperty.call(obj, key)) {
              obj[key] = val;
            } else if (angular.isArray(obj[key])) {
              obj[key].push(val);
            } else {
              obj[key] = [obj[key],val];
            }
          }
        }
      });
      return obj;
    }
    function tryDecodeURIComponent(value) {
      try {
        return decodeURIComponent(value);
      } catch (e) {
        // Ignore any invalid uri component
      }
    }
  };
}

function createMockXhr() {
  return new MockXhr();
}

function MockXhr() {

  // hack for testing $http, $httpBackend
  MockXhr.$$lastInstance = this;

  this.open = function(method, url, async) {
    this.$$method = method;
    this.$$url = url;
    this.$$async = async;
    this.$$reqHeaders = {};
    this.$$respHeaders = {};
  };

  this.send = function(data) {
    this.$$data = data;
  };

  this.setRequestHeader = function(key, value) {
    this.$$reqHeaders[key] = value;
  };

  this.getResponseHeader = function(name) {
    // the lookup must be case insensitive,
    // that's why we try two quick lookups first and full scan last
    var header = this.$$respHeaders[name];
    if (header) return header;

    name = angular.lowercase(name);
    header = this.$$respHeaders[name];
    if (header) return header;

    header = undefined;
    angular.forEach(this.$$respHeaders, function(headerVal, headerName) {
      if (!header && angular.lowercase(headerName) == name) header = headerVal;
    });
    return header;
  };

  this.getAllResponseHeaders = function() {
    var lines = [];

    angular.forEach(this.$$respHeaders, function(value, key) {
      lines.push(key + ': ' + value);
    });
    return lines.join('\n');
  };

  this.abort = angular.noop;

  // This section simulates the events on a real XHR object (and the upload object)
  // When we are testing $httpBackend (inside the angular project) we make partial use of this
  // but store the events directly ourselves on `$$events`, instead of going through the `addEventListener`
  this.$$events = {};
  this.addEventListener = function(name, listener) {
    if (angular.isUndefined(this.$$events[name])) this.$$events[name] = [];
    this.$$events[name].push(listener);
  };

  this.upload = {
    $$events: {},
    addEventListener: this.addEventListener
  };
}
angular.mock.$TimeoutDecorator = ['$delegate', '$browser', function($delegate, $browser) {
  $delegate.flush = function(delay) {
    $browser.defer.flush(delay);
  };


  $delegate.verifyNoPendingTasks = function() {
    if ($browser.deferredFns.length) {
      throw new Error('Deferred tasks to flush (' + $browser.deferredFns.length + '): ' +
          formatPendingTasksAsString($browser.deferredFns));
    }
  };

  function formatPendingTasksAsString(tasks) {
    var result = [];
    angular.forEach(tasks, function(task) {
      result.push('{id: ' + task.id + ', ' + 'time: ' + task.time + '}');
    });

    return result.join(', ');
  }

  return $delegate;
}];

angular.mock.$RAFDecorator = ['$delegate', function($delegate) {
  var rafFn = function(fn) {
    var index = rafFn.queue.length;
    rafFn.queue.push(fn);
    return function() {
      rafFn.queue.splice(index, 1);
    };
  };

  rafFn.queue = [];
  rafFn.supported = $delegate.supported;

  rafFn.flush = function() {
    if (rafFn.queue.length === 0) {
      throw new Error('No rAF callbacks present');
    }

    var length = rafFn.queue.length;
    for (var i = 0; i < length; i++) {
      rafFn.queue[i]();
    }

    rafFn.queue = rafFn.queue.slice(i);
  };

  return rafFn;
}];
var originalRootElement;
angular.mock.$RootElementProvider = function() {
  this.$get = ['$injector', function($injector) {
    originalRootElement = angular.element('<div ng-app></div>').data('$injector', $injector);
    return originalRootElement;
  }];
};

angular.mock.$ControllerDecorator = ['$delegate', function($delegate) {
  return function(expression, locals, later, ident) {
    if (later && typeof later === 'object') {
      var instantiate = $delegate(expression, locals, true, ident);
      angular.extend(instantiate.instance, later);

      var instance = instantiate();
      if (instance !== instantiate.instance) {
        angular.extend(instance, later);
      }

      return instance;
    }
    return $delegate(expression, locals, later, ident);
  };
}];

angular.mock.$ComponentControllerProvider = ['$compileProvider', function($compileProvider) {
  this.$get = ['$controller','$injector', '$rootScope', function($controller, $injector, $rootScope) {
    return function $componentController(componentName, locals, bindings, ident) {
      // get all directives associated to the component name
      var directives = $injector.get(componentName + 'Directive');
      // look for those directives that are components
      var candidateDirectives = directives.filter(function(directiveInfo) {
        // components have controller, controllerAs and restrict:'E'
        return directiveInfo.controller && directiveInfo.controllerAs && directiveInfo.restrict === 'E';
      });
      // check if valid directives found
      if (candidateDirectives.length === 0) {
        throw new Error('No component found');
      }
      if (candidateDirectives.length > 1) {
        throw new Error('Too many components found');
      }
      // get the info of the component
      var directiveInfo = candidateDirectives[0];
      // create a scope if needed
      locals = locals || {};
      locals.$scope = locals.$scope || $rootScope.$new(true);
      return $controller(directiveInfo.controller, locals, bindings, ident || directiveInfo.controllerAs);
    };
  }];
}];


angular.module('ngMockE2E', ['ng']).config(['$provide', function($provide) {
  $provide.value('$httpBackend', angular.injector(['ng']).get('$httpBackend'));
  $provide.decorator('$httpBackend', angular.mock.e2e.$httpBackendDecorator);
}]);
  function countChildScopes() {
    // jshint validthis: true
    var count = 0; // exclude the current scope
    var pendingChildHeads = [this.$$childHead];
    var currentScope;

    while (pendingChildHeads.length) {
      currentScope = pendingChildHeads.shift();

      while (currentScope) {
        count += 1;
        pendingChildHeads.push(currentScope.$$childHead);
        currentScope = currentScope.$$nextSibling;
      }
    }

    return count;
  }
  function countWatchers() {
    // jshint validthis: true
    var count = this.$$watchers ? this.$$watchers.length : 0; // include the current scope
    var pendingChildHeads = [this.$$childHead];
    var currentScope;

    while (pendingChildHeads.length) {
      currentScope = pendingChildHeads.shift();

      while (currentScope) {
        count += currentScope.$$watchers ? currentScope.$$watchers.length : 0;
        pendingChildHeads.push(currentScope.$$childHead);
        currentScope = currentScope.$$nextSibling;
      }
    }

    return count;
  }
}


(function(jasmineOrMocha) {

  if (!jasmineOrMocha) {
    return;
  }

  var currentSpec = null,
      injectorState = new InjectorState(),
      annotatedFunctions = [],
      wasInjectorCreated = function() {
        return !!currentSpec;
      };

  angular.mock.$$annotate = angular.injector.$$annotate;
  angular.injector.$$annotate = function(fn) {
    if (typeof fn === 'function' && !fn.$inject) {
      annotatedFunctions.push(fn);
    }
    return angular.mock.$$annotate.apply(this, arguments);
  };
  var module = window.module = angular.mock.module = function() {
    var moduleFns = Array.prototype.slice.call(arguments, 0);
    return wasInjectorCreated() ? workFn() : workFn;
    /////////////////////
    function workFn() {
      if (currentSpec.$injector) {
        throw new Error('Injector already created, can not register a module!');
      } else {
        var fn, modules = currentSpec.$modules || (currentSpec.$modules = []);
        angular.forEach(moduleFns, function(module) {
          if (angular.isObject(module) && !angular.isArray(module)) {
            fn = ['$provide', function($provide) {
              angular.forEach(module, function(value, key) {
                $provide.value(key, value);
              });
            }];
          } else {
            fn = module;
          }
          if (currentSpec.$providerInjector) {
            currentSpec.$providerInjector.invoke(fn);
          } else {
            modules.push(fn);
          }
        });
      }
    }
  };

  module.$$beforeAllHook = (window.before || window.beforeAll);
  module.$$afterAllHook = (window.after || window.afterAll);

  // purely for testing ngMock itself
  module.$$currentSpec = function(to) {
    if (arguments.length === 0) return to;
    currentSpec = to;
  };
  module.sharedInjector = function() {
    if (!(module.$$beforeAllHook && module.$$afterAllHook)) {
      throw Error("sharedInjector() cannot be used unless your test runner defines beforeAll/afterAll");
    }

    var initialized = false;

    module.$$beforeAllHook(function() {
      if (injectorState.shared) {
        injectorState.sharedError = Error("sharedInjector() cannot be called inside a context that has already called sharedInjector()");
        throw injectorState.sharedError;
      }
      initialized = true;
      currentSpec = this;
      injectorState.shared = true;
    });

    module.$$afterAllHook(function() {
      if (initialized) {
        injectorState = new InjectorState();
        module.$$cleanup();
      } else {
        injectorState.sharedError = null;
      }
    });
  };

  module.$$beforeEach = function() {
    if (injectorState.shared && currentSpec && currentSpec != this) {
      var state = currentSpec;
      currentSpec = this;
      angular.forEach(["$injector","$modules","$providerInjector", "$injectorStrict"], function(k) {
        currentSpec[k] = state[k];
        state[k] = null;
      });
    } else {
      currentSpec = this;
      originalRootElement = null;
      annotatedFunctions = [];
    }
  };

  module.$$afterEach = function() {
    if (injectorState.cleanupAfterEach()) {
      module.$$cleanup();
    }
  };

  module.$$cleanup = function() {
    var injector = currentSpec.$injector;

    annotatedFunctions.forEach(function(fn) {
      delete fn.$inject;
    });

    angular.forEach(currentSpec.$modules, function(module) {
      if (module && module.$$hashKey) {
        module.$$hashKey = undefined;
      }
    });

    currentSpec.$injector = null;
    currentSpec.$modules = null;
    currentSpec.$providerInjector = null;
    currentSpec = null;

    if (injector) {
      // Ensure `$rootElement` is instantiated, before checking `originalRootElement`
      var $rootElement = injector.get('$rootElement');
      var rootNode = $rootElement && $rootElement[0];
      var cleanUpNodes = !originalRootElement ? [] : [originalRootElement[0]];
      if (rootNode && (!originalRootElement || rootNode !== originalRootElement[0])) {
        cleanUpNodes.push(rootNode);
      }
      angular.element.cleanData(cleanUpNodes);

      // Ensure `$destroy()` is available, before calling it
      // (a mocked `$rootScope` might not implement it (or not even be an object at all))
      var $rootScope = injector.get('$rootScope');
      if ($rootScope && $rootScope.$destroy) $rootScope.$destroy();
    }

    // clean up jquery's fragment cache
    angular.forEach(angular.element.fragments, function(val, key) {
      delete angular.element.fragments[key];
    });

    MockXhr.$$lastInstance = null;

    angular.forEach(angular.callbacks, function(val, key) {
      delete angular.callbacks[key];
    });
    angular.callbacks.$$counter = 0;
  };

  (window.beforeEach || window.setup)(module.$$beforeEach);
  (window.afterEach || window.teardown)(module.$$afterEach);
  var ErrorAddingDeclarationLocationStack = function(e, errorForStack) {
    this.message = e.message;
    this.name = e.name;
    if (e.line) this.line = e.line;
    if (e.sourceId) this.sourceId = e.sourceId;
    if (e.stack && errorForStack)
      this.stack = e.stack + '\n' + errorForStack.stack;
    if (e.stackArray) this.stackArray = e.stackArray;
  };
  ErrorAddingDeclarationLocationStack.prototype = Error.prototype;

  window.inject = angular.mock.inject = function() {
    var blockFns = Array.prototype.slice.call(arguments, 0);
    var errorForStack = new Error('Declaration Location');
    // IE10+ and PhanthomJS do not set stack trace information, until the error is thrown
    if (!errorForStack.stack) {
      try {
        throw errorForStack;
      } catch (e) {}
    }
    return wasInjectorCreated() ? workFn.call(currentSpec) : workFn;
    /////////////////////
    function workFn() {
      var modules = currentSpec.$modules || [];
      var strictDi = !!currentSpec.$injectorStrict;
      modules.unshift(['$injector', function($injector) {
        currentSpec.$providerInjector = $injector;
      }]);
      modules.unshift('ngMock');
      modules.unshift('ng');
      var injector = currentSpec.$injector;
      if (!injector) {
        if (strictDi) {
          // If strictDi is enabled, annotate the providerInjector blocks
          angular.forEach(modules, function(moduleFn) {
            if (typeof moduleFn === "function") {
              angular.injector.$$annotate(moduleFn);
            }
          });
        }
        injector = currentSpec.$injector = angular.injector(modules, strictDi);
        currentSpec.$injectorStrict = strictDi;
      }
      for (var i = 0, ii = blockFns.length; i < ii; i++) {
        if (currentSpec.$injectorStrict) {
          // If the injector is strict / strictDi, and the spec wants to inject using automatic
          // annotation, then annotate the function here.
          injector.annotate(blockFns[i]);
        }
        try {
          /* jshint -W040 *//* Jasmine explicitly provides a `this` object when calling functions */
          injector.invoke(blockFns[i] || angular.noop, this);
          /* jshint +W040 */
        } catch (e) {
          if (e.stack && errorForStack) {
            throw new ErrorAddingDeclarationLocationStack(e, errorForStack);
          }
          throw e;
        } finally {
          errorForStack = null;
        }
      }
    }
  };


  angular.mock.inject.strictDi = function(value) {
    value = arguments.length ? !!value : true;
    return wasInjectorCreated() ? workFn() : workFn;

    function workFn() {
      if (value !== currentSpec.$injectorStrict) {
        if (currentSpec.$injector) {
          throw new Error('Injector already created, can not modify strict annotations');
        } else {
          currentSpec.$injectorStrict = value;
        }
      }
    }
  };

  function InjectorState() {
    this.shared = false;
    this.sharedError = null;

    this.cleanupAfterEach = function() {
      return !this.shared || this.sharedError;
    };
  }
})(window.jasmine || window.mocha)


)(window, window.angular);
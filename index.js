/* globals require, module, Service*/
var Service, Characteristic;
var request = require('request');

/**
 * @module homebridge
 * @param {object} homebridge Export functions required to create a
 *                            new instance of this plugin.
 */
module.exports = function (homebridge) {
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    homebridge.registerAccessory('homebridge-http-hsb', 'HTTP-HSB', HTTP_HSB);
};

/**
 * Parse the config and instantiate the object.
 *
 * @summary Constructor
 * @constructor
 * @param {function} log Logging function
 * @param {object} config Your configuration object
 */
function HTTP_HSB (log, config) {

    // The logging function is required if you want your function to output
    // any information to the console in a controlled and organized manner.
    this.log = log;

    this.service                       = 'Light';
    this.name                          = config.name;

    this.http_method                   = config.http_method               || 'GET';
    this.username                      = config.username                  || '';
    this.password                      = config.password                  || '';

    // Local caching of HSB color
    this.cache = {};

    // HSB handling
    if (typeof config.color === 'object') {
        this.color = {};
        this.color.status              = config.color.status;
        this.color.set_url             = config.color.url                 || this.color.status;
        this.color.http_method         = config.color.http_method         || this.http_method;
        this.color.hsb_delimiter       = config.color.hsb_delimiter       || ',';

        // Get State Properties and Variables
        this.color.cacheTime           = config.color.cacheTime           || 500;
        this.color.lastUpdate = null;
        this.color.getCallbackQueue = [];

        // Set State Properties and Variables
        this.color.setLimiterTime = 50;
        this.color.lastSet = null;
        this.color.setCallbackQueue = [];

        // Cache Variables
        this.cache.power = 0;
        this.cache.hue = 0;
        this.cache.saturation = 0;
        this.cache.brightness = 0;
    } else {
        this.color = false;
    }

    if (typeof config.temp === 'object') {
        this.temp = {};
        this.temp.name                  = config.temp.name                 || "Temperature";
        this.temp.url                   = config.temp.url                  || false;
    } else {
        this.color = false;
    }
}

/**
 *
 * @augments HTTP_HSB
 */
HTTP_HSB.prototype = {

    //** Required Functions **//
    identify: function(callback) {
        this.log('Identify requested!');
        callback();
    },

    getServices: function() {
        // You may OPTIONALLY define an information service if you wish to override
        // default values for devices like serial number, model, etc.
        var informationService = new Service.AccessoryInformation();

        informationService
            .setCharacteristic(Characteristic.Manufacturer, 'Setrin')
            .setCharacteristic(Characteristic.Model, 'LedTempPlatform')
            .setCharacteristic(Characteristic.SerialNumber, '01');

        switch (this.service) {
            case 'Light':
                this.log('creating Lightbulb');
                var lightbulbService = new Service.Lightbulb(this.name);

                // Handle color
                if (this.color) {
                    this.log('... adding Power');
                    lightbulbService
                        .getCharacteristic(Characteristic.On)
                        .on('get', function (callback) {this.getState(callback, 'power');}.bind(this))
                        .on('set', function (state, callback) {this.setState(state, callback, 'power');}.bind(this));

                    this.log('... adding Hue');
                    lightbulbService
                        .addCharacteristic(new Characteristic.Hue())
                        .on('get', function (callback) {this.getState(callback, 'hue');}.bind(this))
                        .on('set', function (state, callback) {this.setState(state, callback, 'hue');}.bind(this));

                    this.log('... adding Saturation');
                    lightbulbService
                        .addCharacteristic(new Characteristic.Saturation())
                        .on('get', function (callback) {this.getState(callback, 'saturation');}.bind(this))
                        .on('set', function (state, callback) {this.setState(state, callback, 'saturation');}.bind(this));

                    this.log('... adding Brightness');
                    lightbulbService
                        .addCharacteristic(new Characteristic.Brightness())
                        .on('get', function (callback) {this.getState(callback, 'brightness');}.bind(this))
                        .on('set', function (state, callback) {this.setState(state, callback, 'brightness');}.bind(this));
                }

                if (this.temp) {
                    this.log('creating TemperatureSensor');
                    var temperatureService = new Service.TemperatureSensor(this.temp.name);
                    temperatureService
                        .getCharacteristic(Characteristic.CurrentTemperature)
                        .setProps({
                            minValue: -100,
                            maxValue: 100
                        })
                        .on('get', this.getTemp.bind(this));
                }

                return [informationService, lightbulbService, temperatureService];

            default:
                return [informationService];

        } // end switch
    },

    //** Custom Functions **//

    /**
     * Gets state of lightbulb.
     *
     * @param {function} callback The callback that handles the response.
     * @param {string} type "hue"/"saturation"/"brightness"/"power"
     */
    getState: function(callback, type) {
        if (!this.color) {
            this.log.warn("Ignoring request; problem with 'color' variables.");
            callback(new Error("There was a problem parsing the 'color' section of your configuration."));
            return;
        }

        this._getHSB(callback, type);
    },

    /**
     * Sets state of the lightbulb.
     *
     * @param {number} state State value to be set.
     * @param {function} callback The callback that handles the response.
     * @param {string} type "hue"/"saturation"/"brightness"/"power"
     */
    setState: function(state, callback, type) {
        if (!this.color) {
            this.log.warn("Ignoring request; problem with 'color' variables.");
            callback(new Error("There was a problem parsing the 'color' section of your configuration."));
            return;
        }

        this.cache[type] = state;

        var currentTime = new Date().getTime();
        if (!this.color.lastSet || currentTime - this.color.lastSet > this.color.setLimiterTime) {
            this.color.lastSet = currentTime;
            this._setHSB(callback, type);
        } else {
            this.color.setCallbackQueue.push({'type': type, 'callbackFn': callback});
        }
    },

    /**
     * Gets temperature from sensor.
     *
     * @param {function} callback The callback that handles the response.
     */
    getTemp: function (callback) {
        if (this.temp && typeof this.temp.url !== 'string') {
            this.log.warn("Ignoring request; problem with 'temp' variables.");
            callback(new Error("There was a problem parsing the 'temp' section of your configuration."));
            return;
        }

        var url = this.temp.url;

        this._httpRequest(url, '', 'GET', function(error, response, responseBody) {
            if (error) {
                this.log('... getTemp failed: %s', error.message);
                callback(error);
            } else {
                var temp = null,
                    error = null;
                try {
                    var temp = JSON.parse(responseBody).temperature;
                    
                    if (temp < this.minTemperature || temp > this.maxTemperature || isNaN(temp)) {
                        throw "Invalid value received";
                    }

                    this.log('... getTemp successful, currently: %s', temp);
                } catch (parseErr) {
                    this.log('... getTemp failed: %s', parseErr.message);
                    error = parseErr;
                }
                callback(error, temp);
            }
        }.bind(this));
    },

    /**
     * Gets RGB value and parse it to HSB cache.
     *
     * @param {function} callback The callback that handles the response.
     * @param {string} type "hue"/"saturation"/"brightness"/"power"
     */
    _getHSB: function(callback, type) {
        var url = this.color.status;
        var self = this;

        var currentTime = new Date().getTime();

        if (!this.color.lastUpdate || currentTime - this.color.lastUpdate > this.color.cacheTime) {
            this.color.lastUpdate = currentTime;
            this._httpRequest(url, '', 'GET', function(error, response, responseBody) {
                if (error) {
                    this.log('... _getHSB(' + type + ') failed: %s', error.message);
                    this.color.lastUpdate = null;
                    callback(error);
                } else {
                    var levels = responseBody.split(this.color.hsb_delimiter);
                    var levelsMap = {
                        "hue": parseInt(levels[0]),
                        "saturation": parseInt(levels[1]),
                        "brightness": parseInt(levels[2]),
                        "power": parseInt(levels[3])
                    };

                    this.cache.hue = levelsMap.hue;
                    this.cache.saturation = levelsMap.saturation;
                    this.cache.brightness = levelsMap.brightness;
                    this.cache.power = levelsMap.power;

                    this.log('... _getHSB(' + type + ') successful');
                    this.log('... _getHSB is currently H:%s, S:%s, B:%s, P:%s', this.cache.hue, this.cache.saturation, this.cache.brightness, this.cache.power);
                    callback(null, levelsMap[type]);

                    this.color.getCallbackQueue.forEach(function(queued) {
                        self.log('... _getHSB(' + queued.type + ') returning cached value: %s', self.cache[queued.type]);
                        queued.callbackFn(null, self.cache[queued.type]);
                    });
                    this.color.getCallbackQueue = [];
                }
            }.bind(this));
        } else {
            this.color.getCallbackQueue.push({'type': type, 'callbackFn': callback});
        }
    },

    /**
     * Sets the HSB value of the device based on the cached HSB values.
     *
     * @param {function} callback The callback that handles the response.
     * @param {string} type "hue"/"saturation"/"brightness"/"power"
     */
    _setHSB: function(callback, type) {
        setTimeout(function () {
            var url = this.color.set_url.replace('%s', this.cache.hue + this.color.hsb_delimiter + this.cache.saturation + this.color.hsb_delimiter + this.cache.brightness + this.color.hsb_delimiter + this.cache.power);

            this.color.lastSet = null;
            this.log('_setHSB(' + type + ') url: %s', url);
            this._httpRequest(url, '', this.color.http_method, function (error, response, body) {
                if (error) {
                    this.log('... _setHSB(' + type + ') failed: %s', error);
                    callback(error);
                } else {
                    var self = this;
                    this.log('... _setHSB(' + type + ') successfully set to H:%s, S:%s, B:%s, P:%s', this.cache.hue, this.cache.saturation, this.cache.brightness, this.cache.power);
                    callback();

                    this.color.setCallbackQueue.forEach(function(queued) {
                        self.log('... _setHSB(' + queued.type + ') calling cached callback');
                        queued.callbackFn();
                    });
                    this.color.setCallbackQueue = [];
                }
            }.bind(this));
        }.bind(this), this.color.setLimiterTime);
    },

    /** Utility Functions **/
    /**
     * Perform an HTTP request.
     *
     * @param {string} url URL to call.
     * @param {string} body Body to send.
     * @param {string} method Method to use.
     * @param {function} callback The callback that handles the response.
     */
    _httpRequest: function(url, body, method, callback) {
        request({
            url: url,
            body: body,
            method: method,
            rejectUnauthorized: false,
            auth: {
                user: this.username,
                pass: this.password
            }
        },
        function(error, response, body) {
            callback(error, response, body);
        });
    }
};
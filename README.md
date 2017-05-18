# homebridge-http-hsb

Supports HSB http(s) devices on the HomeBridge Platform and provides a readable
callback for getting and setting the following characteristics to Homekit:

* Characteristic.On
* Characteristic.Brightness
* Characteristic.Hue
* Characteristic.Saturation

# Configuration

### Example config

    "accessories": [

        {
            "accessory": "HTTP-HSB",
            "name": "HSB Led Strip",

            "color": {
                "status": "http://localhost/color",
                "url": "http://localhost/setColor?set=%s",
                "hsb_delimiter": ",",
                "cacheTime": 500
            }
        }
    ]

### Parameters

List of parameters that can or must be used in config.json

##### General params
* `name` (required) name of your accessory.
* `http_method` parent http method (default: "GET").
* `username`
* `password`

##### Color params
* `color.status` (required) url to get HSB device settings.
* `color.url` (required) url to set HSB device settings.
* `color.http_method` http method used in get/set request (default: `http_method`).
* `color.hsb_delimiter` character to be used as delimiter (default: ",").
* `color.cacheTime` time in milliseconds for how long should hold data from get request (default: 500).
* `color.limiterTime` time in milliseconds for how long is wait for set request data (default: 50).

##### Temp params
Temperature sensor is optional, i just wanted to have it on same device (I will probably removed it later).
To use temp sensor, fill required parameters in same way as color.
* `temp.name` (required) name of your temperature sensor [].
* `temp.url` (required) url to get data from device settings .
* `temp.http_method` http method used in get request (default: `http_method`).

# Interfacing

All requests expect a 200 HTTP status code and a body of a single
string with no HTML markup.

* `color.status` expects HSB and Power value [0-360, 0-100, 0-100, 0-1].
* `color.url` send HSB and Power value [0-360, 0-100, 0-100, 0-1].

# Origin

I needed a way to control my RGB Led strip from
HomeKit/HomeBridge. I started using plugin [jnovack/homebridge-better-http-rgb](https://github.com/jnovack/homebridge-better-http-rgb), but soon i found out that RGB format of color
doesn't suit my project, so i took base of the code and rewrote it to support HSB. Then I started eliminating get/set requests as ESP8266 (Controller for Led Strip I used) can't take multiple requests well (Hue, Saturation, Brightness, Power). I was able to merge this requests together, so only one get request is send to get all of the values. Later I added cache for get requests and set limiter.

# To-do

* Update tests
* Remove temp sensor
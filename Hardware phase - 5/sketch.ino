#include <WiFi.h>
#include <WebServer.h>
#include <ESP32Servo.h>

Servo servos[6];

const int servoPins[6] = {13,12,14,27,26,25};

const int JOY_X = 34;
const int JOY_Y = 35;
const int JOY_BTN = 32;

const char* servoNames[6]={
"Base",
"Shoulder",
"Elbow",
"Wrist Pitch",
"Wrist Roll",
"Stylus"
};

int angle[6]={90,90,90,90,90,90};

int currentServo=0;

bool yCentered=true;
unsigned long lastSwitch=0;
const unsigned long switchCooldown=300;

const char* ssid="Wokwi-GUEST";
const char* password="";

WebServer server(80);

String webpage(){

String page=R"rawliteral(

<!DOCTYPE html>
<html>
<head>

<meta name="viewport" content="width=device-width, initial-scale=1">

<style>

body{
font-family:Arial;
background:#111;
color:white;
text-align:center;
}

.slider{
width:320px;
}

.card{
margin:20px auto;
padding:15px;
background:#222;
border-radius:12px;
width:360px;
}

</style>

</head>

<body>

<h2>6 DOF Robot Arm Controller</h2>

)rawliteral";

for(int i=0;i<6;i++){

page+="<div class='card'>";
page+="<h3>";
page+=servoNames[i];
page+="</h3>";

page+="<input type='range' min='0' max='180' value='";
page+=String(angle[i]);
page+="' class='slider' oninput='move(";
page+=String(i);
page+=",this.value)'>";

page+="<p id='v";
page+=String(i);
page+="'>";
page+=String(angle[i]);
page+="</p>";

page+="</div>";

}

page+=R"rawliteral(

<script>

function move(id,val){

document.getElementById("v"+id).innerHTML=val;

fetch("/set?servo="+id+"&angle="+val);

}

</script>

</body>
</html>

)rawliteral";

return page;

}

void handleRoot(){

server.send(200,"text/html",webpage());

}

void handleServo(){

if(server.hasArg("servo") && server.hasArg("angle")){

int s=server.arg("servo").toInt();
int a=server.arg("angle").toInt();

if(s>=0 && s<6){

a=constrain(a,0,180);

angle[s]=a;

servos[s].write(a);

Serial.print(servoNames[s]);
Serial.print(" -> ");
Serial.println(a);

}

}

server.send(200,"text/plain","OK");

}

void setup(){

Serial.begin(115200);

pinMode(JOY_BTN,INPUT_PULLUP);

for(int i=0;i<6;i++){

servos[i].attach(servoPins[i]);

servos[i].write(angle[i]);

}

Serial.println();
Serial.println("Connecting WiFi...");

WiFi.begin(ssid,password);

while(WiFi.status()!=WL_CONNECTED){

delay(500);
Serial.print(".");

}

Serial.println();
Serial.println("Connected!");

Serial.print("IP Address: ");

Serial.println(WiFi.localIP());

server.on("/",handleRoot);

server.on("/set",handleServo);

server.begin();

Serial.println("Web Server Started");

}

void loop(){

server.handleClient();

int x=analogRead(JOY_X);

int y=analogRead(JOY_Y);

if(x<1200){

angle[currentServo]--;

}

if(x>2800){

angle[currentServo]++;

}

angle[currentServo]=constrain(angle[currentServo],0,180);

servos[currentServo].write(angle[currentServo]);

if(y>1200 && y<2800){

yCentered=true;

}

if(yCentered && millis()-lastSwitch>switchCooldown){

if(y>2800){

currentServo++;

if(currentServo>5) currentServo=0;

Serial.print("Selected: ");

Serial.println(servoNames[currentServo]);

yCentered=false;

lastSwitch=millis();

}

else if(y<1200){

currentServo--;

if(currentServo<0) currentServo=5;

Serial.print("Selected: ");

Serial.println(servoNames[currentServo]);

yCentered=false;

lastSwitch=millis();

}

}

delay(15);

}
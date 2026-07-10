#include <ESP32Servo.h>

Servo servos[6];

const int servoPins[6] = {13, 12, 14, 27, 26, 25};

const int JOY_X = 34;
const int JOY_Y = 35;
const int JOY_BTN = 32; // now free - use for reset / center / etc if you want

const char* servoNames[6] = {
  "Base",
  "Shoulder",
  "Elbow",
  "Wrist Pitch",
  "Wrist Roll",
  "Stylus"
};

int angle[6] = {90, 90, 90, 90, 90, 90};
int currentServo = 0;

bool yCentered = true;          // tracks whether joystick has returned to center on Y axis
unsigned long lastSwitch = 0;
const unsigned long switchCooldown = 300; // ms, extra safety debounce

void setup() {
  Serial.begin(115200);
  pinMode(JOY_BTN, INPUT_PULLUP);

  for (int i = 0; i < 6; i++) {
    servos[i].attach(servoPins[i]);
    servos[i].write(angle[i]);
  }

  Serial.println("--------------------------------");
  Serial.println("Robot Controller Started");
  Serial.print("Selected Joint: ");
  Serial.println(servoNames[currentServo]);
  Serial.println("--------------------------------");
}

void loop() {
  // ---------- Read Joystick ----------
  int x = analogRead(JOY_X);
  int y = analogRead(JOY_Y);

  // ---------- Horizontal = move current servo ----------
  if (x < 1200) {
    angle[currentServo]--;
  }
  if (x > 2800) {
    angle[currentServo]++;
  }
  angle[currentServo] = constrain(angle[currentServo], 0, 180);
  servos[currentServo].write(angle[currentServo]);

  // ---------- Vertical = switch joint ----------
  // Require the stick to return to center before it can trigger another switch,
  // otherwise holding it up/down would cycle through joints continuously.
  if (y > 1200 && y < 2800) {
    yCentered = true; // stick back near middle
  }

  if (yCentered && millis() - lastSwitch > switchCooldown) {
    if (y > 2800) { // push up -> next joint
      currentServo++;
      if (currentServo > 5) currentServo = 0;

      Serial.print("Selected Joint : ");
      Serial.println(servoNames[currentServo]);

      yCentered = false;
      lastSwitch = millis();
    }
    else if (y < 1200) { // push down -> previous joint
      currentServo--;
      if (currentServo < 0) currentServo = 5;

      Serial.print("Selected Joint : ");
      Serial.println(servoNames[currentServo]);

      yCentered = false;
      lastSwitch = millis();
    }
  }

  delay(15);
}

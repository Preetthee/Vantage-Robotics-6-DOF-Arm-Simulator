# Vantage Robotics 6-DOF Arm Simulator

A production-ready React application for simulating 6-degree-of-freedom robotic arms, built with Vite, Three.js, and TypeScript.

## Key Features
- 🌐 **Real-time 3D simulation** using Three.js physics engine
- ⚛️ **React component architecture** with TypeScript
- 🚀 **Vite-powered development** with hot module replacement
- 🤖 **Inverse kinematics solver** for realistic arm movement
- 🔍 **Collision detection** with physics engine
- 📐 **Precise motion control** using advanced algorithms

## Project Structure
```
├── src/
│   ├── App.tsx              # Main React component
│   ├── components/
│   │   └── RobotArm.tsx     # Core simulation component
│   ├── ik/                  # Inverse kinematics implementation
│   ├── motion/              # Animation and physics system
│   ├── main.tsx             # Application entry point
│   └── types.ts             # Type definitions
├── public/                  # Static assets
├── vite.config.ts           # Vite configuration
├── package.json             # Project dependencies
└── README.md                # This file
```

## Installation
Prerequisites:
- Node.js 18.x
- npm 9.x

```bash
# Install dependencies
npm install

# Start development server
npm run dev
```

## Usage
1. Add the RobotArm component to your application:
```tsx
// App.tsx
import RobotArm from './components/RobotArm';

function App() {
  return (
    <div className="app">
      <RobotArm 
        armLength={0.8} 
        maxVelocity={1.5} 
        collisionEnabled={true}
      />
    </div>
  );
}
```

2. Configure simulation parameters via props:
```tsx
<RobotArm 
  armLength={1.0}          // Length of robotic arm
  maxVelocity={2.0}        // Maximum joint velocity
  collisionEnabled={true}  // Enable physics collisions
  showDebug={false}        // Hide debug visualization
/>
```

## Development Scripts
| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite development server |
| `npm run build` | Build production bundle |
| `npm run preview` | Preview production build |
| `npm run test` | Run Jest tests |
| `npm run lint` | Run ESLint checks |

## Dependencies
- **Core**: React 18, TypeScript, Vite
- **3D**: Three.js, @types/three
- **Physics**: Cannon.js, @cannon-es/core
- **Testing**: Jest, React Testing Library

## License
This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
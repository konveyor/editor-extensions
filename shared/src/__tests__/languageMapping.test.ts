import {
  getProgrammingLanguageFromUri,
  getProgrammingLanguageForLLM,
} from "../utils/languageMapping";

describe("getProgrammingLanguageFromUri", () => {
  describe("Java detection", () => {
    it("should detect Java from .java files with Unix paths", () => {
      expect(getProgrammingLanguageFromUri("file:///path/to/SomeClass.java")).toBe("Java");
      expect(getProgrammingLanguageFromUri("/path/to/SomeClass.java")).toBe("Java");
    });

    it("should detect Java from .java files with Windows paths", () => {
      expect(getProgrammingLanguageFromUri("file:///C:/path/to/SomeClass.java")).toBe("Java");
      expect(getProgrammingLanguageFromUri("C:\\path\\to\\SomeClass.java")).toBe("Java");
    });

    it("should detect Java from pom.xml", () => {
      expect(getProgrammingLanguageFromUri("file:///path/to/pom.xml")).toBe("Java");
      expect(getProgrammingLanguageFromUri("/path/to/pom.xml")).toBe("Java");
      expect(getProgrammingLanguageFromUri("C:\\path\\to\\pom.xml")).toBe("Java");
    });

    it("should detect Java from Gradle files", () => {
      expect(getProgrammingLanguageFromUri("file:///path/to/build.gradle")).toBe("Java");
      expect(getProgrammingLanguageFromUri("file:///path/to/build.gradle.kts")).toBe("Java");
      expect(getProgrammingLanguageFromUri("file:///path/to/settings.gradle")).toBe("Java");
      expect(getProgrammingLanguageFromUri("C:\\path\\to\\build.gradle")).toBe("Java");
    });
  });

  describe("JavaScript/TypeScript detection", () => {
    it("should detect JavaScript from .js files", () => {
      expect(getProgrammingLanguageFromUri("file:///path/to/app.js")).toBe("JavaScript");
      expect(getProgrammingLanguageFromUri("/path/to/app.js")).toBe("JavaScript");
      expect(getProgrammingLanguageFromUri("C:\\path\\to\\app.js")).toBe("JavaScript");
    });

    it("should detect JavaScript from package.json", () => {
      expect(getProgrammingLanguageFromUri("file:///path/to/package.json")).toBe("JavaScript");
      expect(getProgrammingLanguageFromUri("C:\\path\\to\\package.json")).toBe("JavaScript");
    });

    it("should detect JavaScript from tsconfig.json", () => {
      expect(getProgrammingLanguageFromUri("file:///path/to/tsconfig.json")).toBe("JavaScript");
    });

    it("should detect JavaScript from config files", () => {
      expect(getProgrammingLanguageFromUri("file:///path/to/webpack.config.js")).toBe("JavaScript");
      expect(getProgrammingLanguageFromUri("file:///path/to/vite.config.ts")).toBe("JavaScript");
    });

    it("should detect TypeScript from .ts files", () => {
      expect(getProgrammingLanguageFromUri("file:///path/to/app.ts")).toBe("TypeScript");
      expect(getProgrammingLanguageFromUri("C:\\path\\to\\app.ts")).toBe("TypeScript");
    });
  });

  describe("Python detection", () => {
    it("should detect Python from .py files", () => {
      expect(getProgrammingLanguageFromUri("file:///path/to/script.py")).toBe("Python");
      expect(getProgrammingLanguageFromUri("C:\\path\\to\\script.py")).toBe("Python");
    });

    it("should detect Python from Python config files", () => {
      expect(getProgrammingLanguageFromUri("file:///path/to/setup.py")).toBe("Python");
      expect(getProgrammingLanguageFromUri("file:///path/to/requirements.txt")).toBe("Python");
      expect(getProgrammingLanguageFromUri("file:///path/to/pyproject.toml")).toBe("Python");
      expect(getProgrammingLanguageFromUri("C:\\path\\to\\requirements.txt")).toBe("Python");
    });
  });

  describe("Go detection", () => {
    it("should detect Go from .go files", () => {
      expect(getProgrammingLanguageFromUri("file:///path/to/main.go")).toBe("Go");
      expect(getProgrammingLanguageFromUri("C:\\path\\to\\main.go")).toBe("Go");
    });

    it("should detect Go from go.mod", () => {
      expect(getProgrammingLanguageFromUri("file:///path/to/go.mod")).toBe("Go");
      expect(getProgrammingLanguageFromUri("file:///path/to/go.sum")).toBe("Go");
      expect(getProgrammingLanguageFromUri("C:\\path\\to\\go.mod")).toBe("Go");
    });
  });

  describe("Rust detection", () => {
    it("should detect Rust from .rs files", () => {
      expect(getProgrammingLanguageFromUri("file:///path/to/main.rs")).toBe("Rust");
      expect(getProgrammingLanguageFromUri("C:\\path\\to\\main.rs")).toBe("Rust");
    });

    it("should detect Rust from Cargo files", () => {
      expect(getProgrammingLanguageFromUri("file:///path/to/Cargo.toml")).toBe("Rust");
      expect(getProgrammingLanguageFromUri("file:///path/to/Cargo.lock")).toBe("Rust");
      expect(getProgrammingLanguageFromUri("C:\\path\\to\\Cargo.toml")).toBe("Rust");
    });
  });

  describe("Ruby detection", () => {
    it("should detect Ruby from .rb files", () => {
      expect(getProgrammingLanguageFromUri("file:///path/to/app.rb")).toBe("Ruby");
      expect(getProgrammingLanguageFromUri("C:\\path\\to\\app.rb")).toBe("Ruby");
    });

    it("should detect Ruby from Ruby config files", () => {
      expect(getProgrammingLanguageFromUri("file:///path/to/Gemfile")).toBe("Ruby");
      expect(getProgrammingLanguageFromUri("file:///path/to/Rakefile")).toBe("Ruby");
      expect(getProgrammingLanguageFromUri("file:///path/to/Podfile")).toBe("Ruby");
      expect(getProgrammingLanguageFromUri("C:\\path\\to\\Gemfile")).toBe("Ruby");
    });
  });

  describe("Edge cases", () => {
    it("should handle case-insensitive file matching", () => {
      expect(getProgrammingLanguageFromUri("file:///path/to/POM.XML")).toBe("Java");
      expect(getProgrammingLanguageFromUri("file:///path/to/PACKAGE.JSON")).toBe("JavaScript");
    });

    it("should default to Java for unknown files (backward compatibility)", () => {
      expect(getProgrammingLanguageFromUri("file:///path/to/unknown.xyz")).toBe("Java");
      expect(getProgrammingLanguageFromUri("C:\\path\\to\\unknown.xyz")).toBe("Java");
    });

    it("should handle empty or missing filename", () => {
      expect(getProgrammingLanguageFromUri("file:///path/to/")).toBe("Java");
      expect(getProgrammingLanguageFromUri("")).toBe("Java");
    });
  });
});

describe("getProgrammingLanguageForLLM", () => {
  it("should map java to Java", () => {
    expect(getProgrammingLanguageForLLM("java")).toBe("Java");
  });

  it("should map javascript to JavaScript", () => {
    expect(getProgrammingLanguageForLLM("javascript")).toBe("JavaScript");
  });

  it("should map typescript to TypeScript", () => {
    expect(getProgrammingLanguageForLLM("typescript")).toBe("TypeScript");
  });

  it("should map python to Python", () => {
    expect(getProgrammingLanguageForLLM("python")).toBe("Python");
  });

  it("should map cpp to C++", () => {
    expect(getProgrammingLanguageForLLM("cpp")).toBe("C++");
  });

  it("should map csharp to C#", () => {
    expect(getProgrammingLanguageForLLM("csharp")).toBe("C#");
  });

  it("should default to Java for unknown languages", () => {
    expect(getProgrammingLanguageForLLM("unknown")).toBe("Java");
  });
});

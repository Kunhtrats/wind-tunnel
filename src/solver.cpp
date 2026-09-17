#include <algorithm>
#include <cmath>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>
#include <emscripten/bind.h>

using emscripten::val;
constexpr int CX[] = {0, 1, 0, -1, 0, 1, -1, -1, 1};
constexpr int CY[] = {0, 0, 1, 0, -1, 1, 1, -1, -1};
constexpr int OPP[] = {0, 3, 4, 1, 2, 7, 8, 5, 6};
constexpr double W[] = {4./9, 1./9, 1./9, 1./9, 1./9, 1./36, 1./36, 1./36, 1./36};
constexpr double PI = 3.14159265358979323846;
double equilibrium(int q, double rho, double u, double v) {
  if (q < 0 || q > 8) throw std::runtime_error("Invalid lattice direction.");
  const double cu = CX[q] * u + CY[q] * v;
  return W[q] * rho * (1 + 3 * cu + 4.5 * cu * cu - 1.5 * (u * u + v * v));
}
bool bodyAt(double X, double Y, int shape, double angle) {
  const double a = angle * PI / 180, dx = X - .72, dy = Y - .5;
  const double rx = dx * std::cos(a) - dy * std::sin(a), ry = dx * std::sin(a) + dy * std::cos(a);
  if (shape == 3) return dx * dx + dy * dy < .125 * .125;
  if (shape == 4) return std::abs(rx) < .16 && std::abs(ry) < .018;
  if (shape == 0) {
    const double t = (rx + .22) / .44;
    return t >= 0 && t <= 1 && std::abs(ry) <= 5 * .18 * .44 * (.2969 * std::sqrt(t) - .126 * t - .3516 * t*t + .2843 * t*t*t - .1036 * t*t*t*t);
  }
  if (shape == 1) {
    const double neck = std::abs(X - .95) < .65 ? .5 * (1 + std::cos(PI * (X - .95) / .65)) : 0;
    return Y < .08 + .23 * neck || Y > .92 - .23 * neck;
  }
  return shape == 2 && ((X < .65 && Y >= .4) || ((X - .65)*(X - .65) + (Y - .65)*(Y - .65) < .25*.25));
}
struct Config {
  int width, shape, source;
  double speed, viscosity, angle, heat, fanX, fanY, direction;
  void validate() const {
    if ((width != 192 && width != 288 && width != 384 && width != 576) || shape < 0 || shape > 5 || source < 0 || source > 1)
      throw std::runtime_error("Invalid simulation parameters.");
    for (double x : {speed, viscosity, angle, heat, fanX, fanY, direction})
      if (!std::isfinite(x)) throw std::runtime_error("Simulation parameters must be finite.");
    if (speed < 0 || speed > .09 || viscosity < .02 || viscosity > .12 || std::abs(angle) > 20 || heat < 0 || heat > 100 || fanX < .03 || fanX > .97 || fanY < .08 || fanY > .92 || std::abs(direction) > 180)
      throw std::runtime_error("Invalid simulation parameters.");
  }
};
class Solver {
  Config c;
  int h, n;
  double steps = 0, fanU = 0, fanV = 0, maxSpeed = 0;
  bool failed = false;
  std::vector<double> f, next, rho, u, v, temperature, nextTemperature, fields;
  std::vector<unsigned char> solid, wall;
  std::vector<std::pair<int, double>> fan;
  void buildFan() {
    fan.clear();
    const double a = c.direction * PI / 180, co = std::cos(a), si = std::sin(a);
    fanU = co * c.speed; fanV = si * c.speed;
    if (!c.source) return;
    for (int y = 1; y < h - 1; ++y) for (int x = 1; x < c.width - 1; ++x) {
      const double dx = x - c.fanX * (c.width - 1), dy = y - c.fanY * (h - 1);
      const double along = (dx * co + dy * si) / (h * .025), across = (-dx * si + dy * co) / (h * .09);
      if (std::abs(along) < 1 && std::abs(across) < 1 && !solid[x + y * c.width])
        fan.emplace_back(x + y * c.width, .15 * (1 - along*along) * (1 - across*across));
    }
  }
public:
  explicit Solver(Config config) : c(config) {
    c.validate(); h = c.width / 2; n = c.width * h;
    f.resize(n*9); next.resize(n*9); rho.assign(n, 1); u.resize(n); v.resize(n);
    temperature.assign(n, 20); nextTemperature.resize(n); fields.resize(n*4); solid.resize(n); wall.resize(n);
    for (int y = 0; y < h; ++y) for (int x = 0; x < c.width; ++x) {
      const int i = x + y * c.width;
      const bool body = bodyAt(double(x)/h, double(y)/h, c.shape, c.angle);
      wall[i] = y == 0 || y == h - 1; solid[i] = body || wall[i];
      if (body && !wall[i]) temperature[i] = c.heat;
      u[i] = solid[i] ? 0 : inlet(y);
      for (int q = 0; q < 9; ++q) f[i*9+q] = equilibrium(q, 1, u[i], 0);
    }
    buildFan();
  }
  double inlet(int y) const {
    if (c.source) return 0;
    if (c.shape != 2) return c.speed;
    const double t = (double(y)/h - .32) / .08;
    return t > 0 && t < 1 ? c.speed * 4 * t * (1 - t) : 0;
  }
  void update(Config config) {
    config.validate();
    if (config.width != c.width || config.shape != c.shape) throw std::runtime_error("Shape and resolution changes require reset.");
    std::vector<unsigned char> mask(n);
    for (int i = 0; i < n; ++i) mask[i] = wall[i] || bodyAt(double(i % c.width)/h, double(i / c.width)/h, config.shape, config.angle);
    // ponytail: changed cells re-equilibrate; use conservative moving boundaries for quantitative pitching-wing loads.
    for (int i = 0; i < n; ++i) {
      if (solid[i] != mask[i]) {
        double r = 0, ux = 0, vy = 0, t = 0; int count = 0;
        for (int j : {i-1, i+1, i-c.width, i+c.width}) if (j >= 0 && j < n && std::abs(j % c.width - i % c.width) <= 1 && !solid[j] && !mask[j]) {
          r += rho[j]; ux += u[j]; vy += v[j]; t += temperature[j]; ++count;
        }
        r = count ? r/count : 1; ux = count ? ux/count : 0; vy = count ? vy/count : 0;
        if (mask[i]) ux = vy = 0;
        rho[i] = r; u[i] = ux; v[i] = vy; temperature[i] = count ? t/count : 20;
        for (int q = 0; q < 9; ++q) f[i*9+q] = next[i*9+q] = equilibrium(q, r, ux, vy);
      }
      if (mask[i]) temperature[i] = wall[i] ? 20 : config.heat;
    }
    c = config; solid.swap(mask); buildFan();
  }
  void step() {
    if (failed) throw std::runtime_error("Solver stopped after instability. Reset required.");
    const int w = c.width;
    const double omega = 1 / (.5 + 3 * c.viscosity);
    for (const auto& [i, strength] : fan) {
      const double ux = u[i] + strength * (fanU - u[i]), vy = v[i] + strength * (fanV - v[i]);
      for (int q = 0; q < 9; ++q) f[i*9+q] += equilibrium(q, rho[i], ux, vy) - equilibrium(q, rho[i], u[i], v[i]);
      u[i] = ux; v[i] = vy;
    }
    // BGK collision, push streaming, halfway no-slip bounce-back.
    for (int i = 0; i < n; ++i) {
      if (solid[i]) continue;
      const int x = i % w, y = i / w, base = i*9;
      for (int q = 0; q < 9; ++q) {
        const double value = f[base+q] + omega * (equilibrium(q, rho[i], u[i], v[i]) - f[base+q]);
        const int nx = x + CX[q], ny = y + CY[q], j = nx + ny*w;
        if (ny < 0 || ny >= h || (nx >= 0 && nx < w && solid[j])) next[base+OPP[q]] = value;
        else if (nx >= 0 && nx < w) next[j*9+q] = value;
      }
    }
    for (int y = 1; y < h - 1; ++y) {
      const int i = y*w, b = i*9;
      if (!solid[i] && c.source) {
        for (int q = 0; q < 9; ++q) next[b+q] = next[b+9+q];
      } else if (!solid[i]) {
        const double ux = inlet(y);
        const double r = (next[b] + next[b+2] + next[b+4] + 2*(next[b+3] + next[b+6] + next[b+7])) / (1-ux);
        next[b+1] = next[b+3] + 2*r*ux/3;
        next[b+5] = next[b+7] + (next[b+4]-next[b+2])/2 + r*ux/6;
        next[b+8] = next[b+6] + (next[b+2]-next[b+4])/2 + r*ux/6;
      }
      const int out = i+w-1;
      if (!solid[out]) for (int q = 0; q < 9; ++q) next[out*9+q] = next[(out-1)*9+q];
    }
    f.swap(next);
    for (int i = 0; i < n; ++i) {
      if (solid[i]) continue;
      double r = 0, ux = 0, vy = 0;
      for (int q = 0; q < 9; ++q) { const double value = f[i*9+q]; r += value; ux += value*CX[q]; vy += value*CY[q]; }
      ux /= r; vy /= r;
      if (!std::isfinite(r+ux+vy) || r < .5 || r > 1.5 || ux*ux+vy*vy > .04) {
        failed = true;
        throw std::runtime_error("Low-Mach stability limit exceeded. Reduce speed or increase viscosity, then reset.");
      }
      rho[i] = r; u[i] = ux; v[i] = vy;
    }
    // ponytail: first-order upwind heat transport is diffusive; upgrade for quantitative heat-transfer studies.
    const double alpha = c.viscosity / .71;
    for (int y = 0; y < h; ++y) for (int x = 0; x < w; ++x) {
      const int i = x+y*w;
      if (solid[i]) { nextTemperature[i] = wall[i] ? 20 : c.heat; continue; }
      if (x == 0) { nextTemperature[i] = 20; continue; }
      const double t = temperature[i], left = temperature[i-1], right = temperature[x == w-1 ? i : i+1], top = temperature[i-w], bottom = temperature[i+w];
      nextTemperature[i] = t - u[i]*(u[i] >= 0 ? t-left : right-t) - v[i]*(v[i] >= 0 ? t-top : bottom-t) + alpha*(left+right+top+bottom-4*t);
    }
    }
    temperature.swap(nextTemperature); ++steps;
  }
  val snapshot() {
    double reference = 0; int count = 0; maxSpeed = 0;
    for (int y = 1; y < h-1; ++y) { const int i = (y+1)*c.width-1; if (!solid[i]) { reference += rho[i]; ++count; } }
    reference /= count ? count : 1;
    for (int i = 0; i < n; ++i) {
      fields[i*4] = u[i]; fields[i*4+1] = v[i]; fields[i*4+2] = solid[i] ? 0 : (rho[i]-reference)/3; fields[i*4+3] = temperature[i];
      maxSpeed = std::max(maxSpeed, std::hypot(u[i], v[i]));
    }
    val result = val::object(); result.set("fields", view("fields")); result.set("steps", steps);
    result.set("maxSpeed", maxSpeed); result.set("reynolds", c.speed*(h/4.)/c.viscosity); return result;
  }
  val view(const std::string& name) {
    if (name == "solid") return val(emscripten::typed_memory_view(solid.size(), solid.data()));
    if (name == "wall") return val(emscripten::typed_memory_view(wall.size(), wall.data()));
    auto* data = name == "f" ? &f : name == "rho" ? &rho : name == "u" ? &u : name == "v" ? &v : name == "temperature" ? &temperature : name == "fields" ? &fields : nullptr;
    if (!data) throw std::runtime_error("Unknown field.");
    return val(emscripten::typed_memory_view(data->size(), data->data()));
  }
  double getSteps() const { return steps; }
};
EMSCRIPTEN_BINDINGS(flow) {
  emscripten::value_object<Config>("Config")
    .field("width", &Config::width).field("shape", &Config::shape).field("source", &Config::source)
    .field("speed", &Config::speed).field("viscosity", &Config::viscosity).field("angle", &Config::angle)
    .field("heat", &Config::heat).field("fanX", &Config::fanX).field("fanY", &Config::fanY).field("direction", &Config::direction);
  emscripten::class_<Solver>("Solver").constructor<Config>()
    .function("step", &Solver::step).function("update", &Solver::update).function("snapshot", &Solver::snapshot)
    .function("view", &Solver::view).function("inlet", &Solver::inlet).property("steps", &Solver::getSteps);
  emscripten::function("equilibrium", &equilibrium);
  emscripten::function("bodyAt", &bodyAt);
}
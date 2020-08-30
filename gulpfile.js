// init mod 
const { src, dest, series, parallel } = require('gulp');
// Importing all the Gulp-related packages we want to use
const gulp = require('gulp');
const sourcemaps = require('gulp-sourcemaps');
const sass = require('gulp-sass');
const concat = require('gulp-concat');
const uglify = require('gulp-uglify');
const postcss = require('gulp-postcss');
const autoprefixer = require('autoprefixer');
const cssnano = require('cssnano');
var browserSync = require('browser-sync').create();


// path vars 
const files = { 
    scssPath: 'src/scss/*.scss',
    jsPath: 'src/js/*.js'
}

//build task
function scssTask(){    
    return src(files.scssPath)
        .pipe(sourcemaps.init()) // initialize sourcemaps first
        .pipe(sass()) // compile SCSS to CSS
        .pipe(postcss([ autoprefixer(), cssnano() ])) // PostCSS plugins
        .pipe(sourcemaps.write('.')) // write sourcemaps file in current directory
        .pipe(dest('app')
     ); // put final CSS in dist folder
}

function jsTask(){
    return src([
        files.jsPath
        //,'!' + 'includes/js/jquery.min.js', // to exclude any specific files
        ])
        .pipe(concat('all.js'))
        .pipe(uglify())
        .pipe(dest('app')
    );
}
function htmlTask(){
    return gulp.src('src/*.html')
    .pipe(gulp.dest('app'))
};


// Watcher
function style() {
    return gulp.src('src/scss/**/*.scss')
    .pipe(sass().on('error',sass.logError))
    .pipe(gulp.dest('src'))
    .pipe(browserSync.stream());
}
function watch() {
    browserSync.init({
        server: {
           baseDir: "./src",
           index: "/index.html"
        }
    });
    gulp.watch('src/scss/**/*.scss', style)
    gulp.watch('src/*.html').on('change',browserSync.reload);
    gulp.watch('src/js/*.js').on('change', browserSync.reload);
}

exports.htmlTask = htmlTask;
exports.style = style;
exports.watch = watch;
exports.default = series(
    parallel(scssTask, jsTask, htmlTask), 
);
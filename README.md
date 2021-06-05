# Crow

| src/
  | v1/
    | book/
      | get/
        | index.js
      | post/
        | index.js
      | chapters/
        | get/
          | index.js
    | authors/
      | get/
        | index.js
      | post/
        | index.js

The preceding file structure will create an API with the following routes:
- GET /v1/book
- POST /v1/book
- GET /v1/book/chapters
- GET /v1/authors
- POST /v1/authors

There needs to be an `index.js` file inside of a folder named after an HTTP method in order for a path to be created. The `index.js` file needs to export a `handler` method that will process the payload and return.

**Note** Each route is responsible for its own dependencies including those used by the shared code. I know this is weird, but I have not taken the time to come up with a convenient way to merge two modules' dependencies yet. This means there should be no dependencies saved in the shared module, please do all of that in the target module.

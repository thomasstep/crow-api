exports.handler = async function (event, context, callback) {
  try {
    const data = {
      statusCode: 201,
    };
    return data;
  } catch (uncaughtError) {
    console.error(uncaughtError);
    throw uncaughtError;
  }
}